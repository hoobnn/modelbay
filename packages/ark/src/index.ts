/**
 * `@modelbay/ark` — Volcengine Ark adapter.
 *
 * Two `PlatformAdapter`s are exported (matching plein's two data planes):
 * - `arkAdapter` (channel `ark`): pay-as-you-go `/api/v3`
 * - `arkPlanAdapter` (channel `ark-plan`): Agent Plan `/api/plan/v3`
 *
 * Both expose `models` / `channels`; the root entry stays runtime-agnostic.
 * Node-only pieces (TOS/S3 upload, signed plan directory, ASR codec) live in
 * `src/node/**` and are exported from the optional `@modelbay/ark/node` subpath.
 *
 * Those Node pieces are injection points: `createArkAdapter(models, { uploadVideo })`
 * and `createArkPlanAdapter(models, { uploadVideo, transcribePlan, listPlanModels })`
 * take them from the `@modelbay/ark/node` subpath (`nodeOptions` bundles all three),
 * so the root entry never pulls in the object-storage SDK, `ws` or `node:crypto`.
 */
import {
  ProviderError,
  defineAdapter,
  resolveModel,
  type AdapterContext,
  type AdapterRequest,
  type CapabilityInput,
  type ChannelRef,
  type ModelDeclaration,
  type ModelLimits,
  type PlatformAdapter,
  type RemoteModel,
  type SubmitResult,
} from '@modelbay/core'
import { all } from './models/index'
import { chatCompletion } from './chat'
import {
  cancelVideo,
  cutoutBody,
  imageBody,
  openAiModelList,
  parseCutoutResponse,
  parseImageResponse,
  pollVideo,
  submitVideo,
  videoBody,
  type TaskOptions,
} from './media'
import { synthesizePlanSpeech } from './speech'
import { request } from './http'
import type { ArkAdapterOptions } from './reference'

export type {
  ArkAdapterOptions,
  PlanDirectory,
  PlanTranscriber,
  ReferenceFile,
  ReferenceVideoUploader,
} from './reference'
export { REFERENCE_STORAGE_KEYS } from './reference'

const API_BASE = 'https://ark.cn-beijing.volces.com/api/v3'
const PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3'
const SECRET = { api: 'ARK_API_KEY', plan: 'ARK_AGENT_PLAN_API_KEY' } as const
const DOCS = 'https://docs.volcengine.com/docs/ark/model-list?lang=zh'
/** 错误文案里的平台名；两个数据面一致，与宿主展示的文案对齐。 */
const LABEL = '火山方舟'

type Plane = 'api' | 'plan'

/**
 * 自定义模型槽：声明里的占位模型 → 设置里的 Endpoint ID。
 * 宿主没有 settings（MCP / CLI）时回退到同名 env / secret。
 */
const CUSTOM_SLOTS: Record<string, { setting: string; secret: string }> = {
  'custom-chat': { setting: 'customChatModel', secret: 'ARK_CUSTOM_CHAT_MODEL' },
  'custom-image': { setting: 'customImageModel', secret: 'ARK_CUSTOM_IMAGE_MODEL' },
  'custom-video': { setting: 'customVideoModel', secret: 'ARK_CUSTOM_VIDEO_MODEL' },
}

/** Channels covered by this package. */
export const channels: string[] = ['ark', 'ark-plan']
/** 方舟两个渠道（按量 / 套餐）的全部模型声明。 */
export const models = all

function planeBase(plane: Plane): string {
  return plane === 'plan' ? PLAN_BASE : API_BASE
}

function planeTitle(plane: Plane): string {
  return plane === 'plan' ? '火山方舟 Agent Plan' : '火山方舟'
}

function planeChannel(plane: Plane): string {
  return plane === 'plan' ? 'ark-plan' : 'ark'
}

const TRANSPORT = {
  cancelled: `${LABEL}请求已取消`,
  network: `${LABEL}网络请求失败；生成提交结果可能未知，不会自动重新提交`,
}

function requireKey(plane: Plane, ctx: AdapterContext): string {
  const key = ctx.secret(SECRET[plane])
  if (!key) throw new ProviderError('auth', `请先配置 ${SECRET[plane]}`)
  return key
}

/**
 * 解析引用到目标渠道的渠道内 ID。
 *
 * 同一个模型在两条渠道各有各的 ID（按量渠道在模型列表页、套餐渠道在套餐
 * 模型目录页），所以按量 ID 与套餐 ID 都能定位到同一条声明；发出去的一律是
 * 目标渠道的 ID。这张对照表从声明派生，不再单独维护一份手写映射。
 *
 * 声明里有这个模型、但它不在目标渠道时直接报错：这种请求发出去也是白花
 * 额度（计费请求前失败）。找不到声明的自定义 ID 照旧透传。
 */
function resolveForPlane(
  ref: string,
  plane: Plane,
  models: ModelDeclaration[],
): { declaration: ModelDeclaration; channel: ChannelRef } | null {
  const channel = planeChannel(plane)
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveModel(models, ref)
  const declaration =
    found?.declaration ?? models.find((item) => item.channels.some((entry) => entry.id === raw))
  if (!declaration) return null
  const entry = declaration.channels.find((item) => item.channel === channel)
  if (!entry)
    throw new ProviderError('invalid_input', `所选模型不在 ${channel} 渠道：${declaration.id}`)
  return { declaration, channel: entry }
}

/**
 * 一次引用解析的结果。
 *
 * `model` 是请求体里用的模型名（渠道内 ID；自定义槽为设置里的 Endpoint ID）；
 * `limits` 是声明里的上限（一次几张、最多几张参考图、有哪些分辨率档位都在这里）。
 */
interface ResolvedModel {
  model: string
  declaration?: ModelDeclaration
  limits: ModelLimits
}

/** Resolve `渠道:渠道内ID` / canonical id / alias to the platform wire id. */
function resolveModelForPlane(
  ref: string,
  plane: Plane,
  models: ModelDeclaration[],
  ctx: AdapterContext,
): ResolvedModel {
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveForPlane(ref, plane, models)
  if (!found) return { model: raw, limits: {} }
  const slot = CUSTOM_SLOTS[found.declaration.id]
  let model = found.channel.id
  if (slot) {
    // 占位模型不能当模型名发出去：必须换成设置里的 Endpoint ID
    const configured = ctx.settings ? ctx.settings[slot.setting] : ctx.secret(slot.secret)
    model = typeof configured === 'string' ? configured.trim() : ''
    if (!model)
      throw new ProviderError('invalid_input', '请在火山方舟设置中填写自定义模型 / Endpoint ID')
  }
  return {
    model,
    declaration: found.declaration,
    limits: { ...found.declaration.limits, ...found.channel.limits },
  }
}

/** Default resolution comes only from the declaration; never hard-coded here. */
function defaultResolution(limits: ModelLimits, kind: '图片' | '视频'): string {
  if (!limits.defaultResolution)
    throw new ProviderError('invalid_input', `所选${kind}模型未声明默认分辨率`)
  return limits.defaultResolution
}

function taskOptions(plane: Plane, ctx: AdapterContext, key: string): TaskOptions {
  return {
    ctx,
    plane,
    base: planeBase(plane),
    key,
    label: LABEL,
    messages: TRANSPORT,
  }
}

async function submit(
  req: AdapterRequest,
  ctx: AdapterContext,
  plane: Plane,
  models: ModelDeclaration[],
  options: ArkAdapterOptions,
): Promise<SubmitResult> {
  const resolved = resolveModelForPlane(req.model, plane, models, ctx)
  const { declaration, model } = resolved
  // 声明里有这个模型就按声明的能力放行；声明外的 ID 只有对话允许走远端模型
  const unsupported = declaration
    ? !declaration.capabilities.includes(req.capability)
    : req.remoteOnly === true && req.capability !== 'text.chat'
  if (unsupported) throw new ProviderError('invalid_input', `所选${LABEL}模型不支持此能力`)
  const key = requireKey(plane, ctx)
  const base = planeBase(plane)
  const post = (path: string, body: unknown) =>
    request({
      ctx,
      url: `${base}${path}`,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      label: LABEL,
      messages: TRANSPORT,
      secrets: [key],
      retries: 0,
    })

  if (req.capability === 'text.chat') {
    return chatCompletion({
      ctx,
      baseURL: base,
      model,
      apiKey: key,
      label: LABEL,
      input: req.input as CapabilityInput<'text.chat'>,
      plan: plane === 'plan',
    })
  }
  if (req.capability === 'image.generate') {
    const body = await imageBody(
      model,
      req.input as CapabilityInput<'image.generate'>,
      ctx,
      resolved.limits,
      defaultResolution(resolved.limits, '图片'),
    )
    return parseImageResponse(await post('/images/generations', body), {
      key,
      outputFormat: body.output_format,
    })
  }
  if (req.capability === 'image.process') {
    const body = await cutoutBody(
      model,
      req.input as CapabilityInput<'image.process'>,
      ctx,
      resolved.limits,
      declaration?.title,
    )
    return parseCutoutResponse(await post('/images/generations', body))
  }
  if (req.capability === 'video.generate') {
    const body = await videoBody({
      plane,
      model,
      input: req.input as CapabilityInput<'video.generate'>,
      ctx,
      defaultResolution: defaultResolution(resolved.limits, '视频'),
      limits: resolved.limits,
      ...(declaration?.optionsSchema ? { optionsSchema: declaration.optionsSchema } : {}),
      ...(declaration?.title ? { title: declaration.title } : {}),
      ...(options.uploadVideo ? { uploadVideo: options.uploadVideo } : {}),
    })
    return submitVideo(body, taskOptions(plane, ctx, key))
  }
  if (req.capability === 'audio.speech' && plane === 'plan') {
    return synthesizePlanSpeech(req.input as CapabilityInput<'audio.speech'>, ctx)
  }
  if (req.capability === 'audio.transcribe' && plane === 'plan') {
    if (!options.transcribePlan)
      throw new ProviderError(
        'unavailable',
        'Agent Plan 流式语音识别需要 Node 子路径：用 createArkPlanAdapter(models, nodeOptions) 注入（@modelbay/ark/node，需要 ws）',
      )
    return options.transcribePlan(req.input as CapabilityInput<'audio.transcribe'>, ctx)
  }
  throw new ProviderError('invalid_input', `${LABEL}不支持此能力：${req.capability}`)
}

/**
 * 套餐模型目录 → 宿主可用的远端模型：
 * 套餐 ID 换回声明里的按量 ID（画布节点换平台不用改模型参数），
 * 嵌入 / 识别模型过滤掉，其余文本模型标成仅内置 Agent 可用。
 */
function planRemoteModels(entries: RemoteModel[], models: ModelDeclaration[]): RemoteModel[] {
  const aliases = new Map<string, string>()
  for (const declaration of models) {
    const api = declaration.channels.find((entry) => entry.channel === 'ark')
    const plan = declaration.channels.find((entry) => entry.channel === 'ark-plan')
    if (api && plan && api.id !== plan.id) aliases.set(plan.id, api.id)
  }
  return entries
    .map((entry) => {
      const id = aliases.get(entry.id) ?? entry.id
      const media = /seedream|seedance|tts|asr|embedding/.test(id)
      return {
        ...entry,
        id,
        ...(!media
          ? {
              kind: 'llm' as const,
              agentOnly: true,
              features: ['tools' as const, 'structured' as const],
            }
          : {}),
      }
    })
    .filter((entry) => !/embedding|asr/.test(entry.id))
}

function makeAdapter(
  plane: Plane,
  models: ModelDeclaration[],
  options: ArkAdapterOptions,
): PlatformAdapter {
  return defineAdapter({
    id: plane === 'plan' ? 'volc/ark-plan' : 'volc/ark',
    title: planeTitle(plane),
    channels: [planeChannel(plane)],
    models,
    nativeOperations: ['listModels', 'listTasks'],
    docsUrl: DOCS,
    nodeOnly: ['tos', 'plan-directory', 'asr'],
    submit: (req, ctx) => submit(req, ctx, plane, models, options),
    poll: (remoteId, ctx) => pollVideo(remoteId, taskOptions(plane, ctx, requireKey(plane, ctx))),
    cancel: (remoteId, ctx) =>
      cancelVideo(remoteId, taskOptions(plane, ctx, requireKey(plane, ctx))),
    native: async (op, _params, ctx) => {
      if (op !== 'listModels' && op !== 'listTasks')
        throw new ProviderError('invalid_input', `未知的 native 操作：${op}`)
      if (op === 'listTasks') {
        // 连接测试：只查任务列表（不计费），验证 Key 与数据面可达
        const key = requireKey(plane, ctx)
        return request({
          ctx,
          url: `${planeBase(plane)}/contents/generations/tasks?page_size=1`,
          method: 'GET',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          label: LABEL,
          messages: TRANSPORT,
          secrets: [key],
          retries: 0,
        })
      }
      if (plane === 'plan') {
        if (!options.listPlanModels)
          throw new ProviderError(
            'unavailable',
            '套餐模型目录请用 @modelbay/ark/node 的 listPlanModels（经 createArkPlanAdapter 的 listPlanModels 选项注入）',
          )
        return planRemoteModels(await options.listPlanModels(ctx), models)
      }
      const key = requireKey(plane, ctx)
      const data = await request({
        ctx,
        url: `${API_BASE}/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        label: LABEL,
        messages: TRANSPORT,
        secrets: [key],
      })
      return openAiModelList(data).map((model) => ({
        ...model,
        features: ['structured' as const],
      }))
    },
  })
}

/**
 * 按量方舟适配器工厂（渠道 `ark`）。
 *
 * 参考视频上传这类 Node 专属能力由宿主注入；没注入时视频参考会明确报错。
 */
export function createArkAdapter(
  models: ModelDeclaration[],
  options: ArkAdapterOptions = {},
): PlatformAdapter {
  return makeAdapter('api', models, options)
}

/**
 * 套餐方舟适配器工厂（渠道 `ark-plan`）。
 *
 * 与按量渠道同一套注入点（`uploadVideo`），另有套餐专属的 `transcribePlan`
 * （语音识别）与 `listPlanModels`（模型目录）；请求路径与鉴权仍走套餐数据面。
 */
export function createArkPlanAdapter(
  models: ModelDeclaration[],
  options: ArkAdapterOptions = {},
): PlatformAdapter {
  return makeAdapter('plan', models, options)
}

/** Pay-as-you-go Ark adapter (channel `ark`). */
export const arkAdapter: PlatformAdapter = createArkAdapter(models)
/** Agent Plan Ark adapter (channel `ark-plan`). */
export const arkPlanAdapter: PlatformAdapter = createArkPlanAdapter(models)
export { arkPlatform } from './platform'
