/**
 * `@modelbay/ark` — Volcengine Ark adapter.
 *
 * Two `PlatformAdapter`s are exported (matching plein's two data planes):
 * - `arkAdapter` (channel `ark`): pay-as-you-go `/api/v3`
 * - `arkPlanAdapter` (channel `ark-plan`): Agent Plan `/api/plan/v3`
 *
 * Both expose `models` / `channels`; the root entry stays runtime-agnostic.
 * Node-only pieces (TOS/S3 upload, signed plan directory, ASR codec) live in
 * `src/node/**` and are exported from the optional `@modelbay/ark/tos` subpath.
 *
 * The reference-video upload is an injection point: `createArkAdapter(models, {
 * uploadVideo })` takes the uploader from the `@modelbay/ark/tos` subpath, so
 * the root entry never pulls in the object-storage SDK.
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
  type SubmitResult,
} from '@modelbay/core'
import { allModels as all } from './declarations'
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

export type { ArkAdapterOptions, ReferenceFile, ReferenceVideoUploader } from './reference'
export { REFERENCE_STORAGE_KEYS } from './reference'

const API_BASE = 'https://ark.cn-beijing.volces.com/api/v3'
const PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3'
const SECRET = { api: 'ARK_API_KEY', plan: 'ARK_AGENT_PLAN_API_KEY' } as const
const DOCS = 'https://docs.volcengine.com/docs/ark/model-list?lang=zh'

type Plane = 'api' | 'plan'

/** Channels covered by this package. */
export const channels: string[] = ['ark', 'ark-plan']
/** 方舟两个渠道（按量 / 套餐）的全部模型声明。 */
export const models = all

function planeBase(plane: Plane): string {
  return plane === 'plan' ? PLAN_BASE : API_BASE
}

function planeLabel(plane: Plane): string {
  return plane === 'plan' ? '火山方舟 Agent Plan' : '火山方舟'
}

function planeChannel(plane: Plane): string {
  return plane === 'plan' ? 'ark-plan' : 'ark'
}

function transportMessages(plane: Plane) {
  return {
    cancelled: `${planeLabel(plane)}请求已取消`,
    network: `${planeLabel(plane)}网络请求失败；生成提交结果可能未知，不会自动重新提交`,
  }
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
 * `model` 是目标渠道的渠道内 ID（请求体里用）；`limits` 是声明里的上限
 * （一次几张、最多几张参考图、有哪些分辨率档位都在这里）。
 */
interface ResolvedModel {
  model: string
  limits: ModelLimits
}

/** Resolve `渠道:渠道内ID` / canonical id / alias to the platform wire id. */
function resolveModelForPlane(
  ref: string,
  plane: Plane,
  models: ModelDeclaration[],
): ResolvedModel {
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveForPlane(ref, plane, models)
  if (!found) return { model: raw, limits: {} }
  return {
    model: found.channel.id,
    limits: { ...found.declaration.limits, ...found.channel.limits },
  }
}

/** Default resolution comes only from the declaration; never hard-coded here. */
function defaultResolution(limits: ModelLimits): string {
  if (!limits.defaultResolution)
    throw new ProviderError('invalid_input', '所选模型未声明默认分辨率')
  return limits.defaultResolution
}

function taskOptions(plane: Plane, ctx: AdapterContext, key: string): TaskOptions {
  return {
    ctx,
    plane,
    base: planeBase(plane),
    key,
    label: planeLabel(plane),
    messages: transportMessages(plane),
  }
}

async function submit(
  req: AdapterRequest,
  ctx: AdapterContext,
  plane: Plane,
  models: ModelDeclaration[],
  options: ArkAdapterOptions,
): Promise<SubmitResult> {
  const key = requireKey(plane, ctx)
  const base = planeBase(plane)
  const label = planeLabel(plane)
  const messages = transportMessages(plane)
  const resolved = resolveModelForPlane(req.model, plane, models)
  const model = resolved.model

  if (req.capability === 'text.chat') {
    return chatCompletion({
      ctx,
      url: `${base}/chat/completions`,
      model,
      apiKey: key,
      label,
      input: req.input as CapabilityInput<'text.chat'>,
      messages,
      structured: 'json_schema',
    })
  }
  if (req.capability === 'image.generate') {
    const body = await imageBody(
      model,
      req.input as CapabilityInput<'image.generate'>,
      ctx,
      resolved.limits,
      defaultResolution(resolved.limits),
    )
    const data = await request({
      ctx,
      url: `${base}/images/generations`,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      label,
      messages,
      secrets: [key],
      retries: 0,
    })
    return parseImageResponse(data)
  }
  if (req.capability === 'image.process') {
    const body = await cutoutBody(model, req.input as CapabilityInput<'image.process'>, ctx)
    const data = await request({
      ctx,
      url: `${base}/images/generations`,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      label,
      messages,
      secrets: [key],
      retries: 0,
    })
    return parseCutoutResponse(data)
  }
  if (req.capability === 'video.generate') {
    const body = await videoBody(
      plane,
      model,
      req.input as CapabilityInput<'video.generate'>,
      ctx,
      defaultResolution(resolved.limits),
      options.uploadVideo,
    )
    return submitVideo(body, taskOptions(plane, ctx, key))
  }
  if (req.capability === 'audio.speech' && plane === 'plan') {
    return synthesizePlanSpeech(req.input as CapabilityInput<'audio.speech'>, ctx)
  }
  if (req.capability === 'audio.transcribe' && plane === 'plan') {
    throw new ProviderError(
      'unavailable',
      'Agent Plan 流式语音识别请使用 @modelbay/ark/tos 的 transcribePlan（Node 子路径，需要 ws）',
    )
  }
  throw new ProviderError('invalid_input', `${label} 不支持此能力：${req.capability}`)
}

function makeAdapter(
  plane: Plane,
  models: ModelDeclaration[],
  options: ArkAdapterOptions,
): PlatformAdapter {
  return defineAdapter({
    id: plane === 'plan' ? 'volc/ark-plan' : 'volc/ark',
    title: planeLabel(plane),
    channels: [planeChannel(plane)],
    models,
    nativeOperations: ['listModels'],
    docsUrl: DOCS,
    nodeOnly: ['tos', 'plan-directory', 'asr'],
    submit: (req, ctx) => submit(req, ctx, plane, models, options),
    poll: (remoteId, ctx) => pollVideo(remoteId, taskOptions(plane, ctx, requireKey(plane, ctx))),
    cancel: (remoteId, ctx) =>
      cancelVideo(remoteId, taskOptions(plane, ctx, requireKey(plane, ctx))),
    native: async (op, _params, ctx) => {
      if (op !== 'listModels') throw new ProviderError('invalid_input', `未知的 native 操作：${op}`)
      if (plane === 'plan')
        throw new ProviderError(
          'unavailable',
          '套餐模型目录请用 @modelbay/ark/tos 的 listPlanModels',
        )
      const key = requireKey(plane, ctx)
      const data = await request({
        ctx,
        url: `${API_BASE}/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        label: planeLabel(plane),
        messages: transportMessages(plane),
        secrets: [key],
      })
      return openAiModelList(data)
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
 * 与按量渠道同一套注入点：请求路径与鉴权仍走套餐数据面。
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
