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
 */
import {
  ProviderError,
  defineAdapter,
  resolveModel,
  type AdapterContext,
  type AdapterRequest,
  type CapabilityInput,
  type ModelLimits,
  type PlatformAdapter,
  type SubmitResult,
} from '@modelbay/core'
import { all } from './declarations'
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
  wireModel,
  type TaskOptions,
} from './media'
import { synthesizePlanSpeech } from './speech'
import { request } from './http'

const API_BASE = 'https://ark.cn-beijing.volces.com/api/v3'
const PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3'
const SECRET = { api: 'ARK_API_KEY', plan: 'ARK_AGENT_PLAN_API_KEY' } as const
const DOCS = 'https://docs.volcengine.com/docs/ark/model-list?lang=zh'

type Plane = 'api' | 'plan'

/** Channels covered by this package. */
export const channels: string[] = ['ark', 'ark-plan']
/** All declared models (empty until the declarations task lands). */
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

/** Resolve `渠道:渠道内ID` / canonical id / alias to the platform wire id. */
function modelId(ref: string, plane: Plane): string {
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveModel(all, ref)
  const match = found?.declaration.channels.find((item) => item.channel === planeChannel(plane))
  return match?.id ?? raw
}

/** Default resolution comes only from the declaration; never hard-coded here. */
function defaultResolution(ref: string): string {
  const found = resolveModel(all, ref)
  const limits: ModelLimits = found ? { ...found.declaration.limits, ...found.channel.limits } : {}
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
): Promise<SubmitResult> {
  const key = requireKey(plane, ctx)
  const base = planeBase(plane)
  const label = planeLabel(plane)
  const messages = transportMessages(plane)
  const model = modelId(req.model, plane)

  if (req.capability === 'text.chat') {
    return chatCompletion({
      ctx,
      url: `${base}/chat/completions`,
      model: wireModel(plane, model),
      apiKey: key,
      label,
      input: req.input as CapabilityInput<'text.chat'>,
      messages,
      structured: 'json_schema',
    })
  }
  if (req.capability === 'image.generate') {
    const body = await imageBody(
      plane,
      model,
      req.input as CapabilityInput<'image.generate'>,
      ctx,
      defaultResolution(req.model),
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
    const body = await cutoutBody(plane, model, req.input as CapabilityInput<'image.process'>, ctx)
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
      defaultResolution(req.model),
    )
    return submitVideo(body, taskOptions(plane, ctx, key))
  }
  if (req.capability === 'audio.speech' && plane === 'plan') {
    return synthesizePlanSpeech(req.input as CapabilityInput<'audio.speech'>, ctx)
  }
  if (req.capability === 'audio.transcribe' && plane === 'plan') {
    throw new ProviderError(
      'unavailable',
      'TODO: Agent Plan 流式语音识别请使用 @modelbay/ark/tos 的 transcribePlan（需宿主 socket 钩子）',
    )
  }
  throw new ProviderError('invalid_input', `${label} 不支持此能力：${req.capability}`)
}

function makeAdapter(plane: Plane): PlatformAdapter {
  return defineAdapter({
    id: plane === 'plan' ? 'volc/ark-plan' : 'volc/ark',
    title: planeLabel(plane),
    channels: [planeChannel(plane)],
    models,
    nativeOperations: ['listModels'],
    docsUrl: DOCS,
    nodeOnly: ['tos', 'plan-directory', 'asr'],
    submit: (req, ctx) => submit(req, ctx, plane),
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

/** Pay-as-you-go Ark adapter (channel `ark`). */
export const arkAdapter: PlatformAdapter = makeAdapter('api')
/** Agent Plan Ark adapter (channel `ark-plan`). */
export const arkPlanAdapter: PlatformAdapter = makeAdapter('plan')
