/**
 * `@modelbay/openai` — OpenAI and OpenAI-compatible adapters.
 *
 * - `openaiAdapter` (channel `openai`): the official `https://api.openai.com/v1` API.
 * - `openaiCompatibleAdapter` (channel `openai-compatible`): a single custom
 *   Chat Completions channel whose Base URL / model id are supplied by the host.
 *
 * 官方渠道的 text.chat 走 `/responses`（加密思考续传），兼容渠道走流式
 * `/chat/completions`（SSE 必须以 `[DONE]` 结束）。The root entry is runtime-agnostic;
 * sharp-based mask inversion lives in the optional `@modelbay/openai/node`
 * subpath.
 */
import {
  ProviderError,
  defineAdapter,
  resolveModel,
  type AdapterContext,
  type AdapterRequest,
  type CapabilityInput,
  type ModelDeclaration,
  type PlatformAdapter,
  type SubmitResult,
} from '@modelbay/core'
import { responsesRequest } from './native'
export { nativeOperationSchemas } from './native'
import { all } from './models/index'
import { classifyOpenAI, compatibleChat, responsesChat } from './chat'
import { asJson, request, type Json, type TransportMessages } from './http'
import { normalizedBase } from './config'
import { buildEditBody, buildImageBody, parseImageResponse } from './media'
import { openAiModelList } from '@modelbay/shared'
import type { OpenAIAdapterOptions } from './mask'

export type { EditMaskInput, EditMaskPreparer, ImageBytes, PreparedEdit } from './mask'
export type { OpenAIAdapterOptions } from './mask'
export { compatibleBaseURL, normalizedBase } from './config'

const OPENAI_BASE = 'https://api.openai.com/v1'
const DOCS = 'https://developers.openai.com/api/docs'

type Kind = 'openai' | 'compatible'

/** Channels covered by this package. */
export const channels: string[] = ['openai', 'openai-compatible']
/** OpenAI 与 OpenAI 兼容渠道的全部模型声明。 */
export const models = all

function label(kind: Kind): string {
  return kind === 'openai' ? 'OpenAI' : '兼容渠道'
}

function messages(kind: Kind): TransportMessages {
  if (kind === 'compatible')
    return {
      cancelled: '兼容渠道提交可能已受理，请勿直接重提',
      network: '兼容渠道提交状态未知，请勿直接重提',
    }
  return {
    cancelled: `${label(kind)}请求已取消；生成提交可能已受理`,
    network: `${label(kind)}网络请求失败；生成提交结果未知，请勿直接重提`,
  }
}

/**
 * 密钥名：官方渠道 `OPENAI_API_KEY`；兼容渠道接受 `COMPATIBLE_API_KEY`（宿主常用的命名，
 * 先查，避免宿主对未声明密钥直接拒绝）或 `OPENAI_COMPATIBLE_API_KEY`。前后空白一律去掉。
 */
function requireKey(kind: Kind, ctx: AdapterContext): string {
  const key =
    kind === 'openai'
      ? ctx.secret('OPENAI_API_KEY')?.trim()
      : (ctx.secret('COMPATIBLE_API_KEY') ?? ctx.secret('OPENAI_COMPATIBLE_API_KEY'))?.trim()
  if (!key)
    throw new ProviderError('auth', kind === 'openai' ? '请填写 OpenAI API Key' : '请填写 API Key')
  return key
}

/** Resolve `渠道:渠道内ID` / canonical id / alias to the platform wire id. */
function modelId(ref: string, models: ModelDeclaration[]): string {
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveModel(models, ref)
  return found?.channel.id ?? raw
}

/**
 * Base URL for the compatible channel. 优先取宿主透传的 `ctx.settings.baseURL`，
 * 其次 `input.extra.baseURL`（单次请求覆盖），最后是 `OPENAI_COMPATIBLE_BASE_URL`
 * 配置项。Public URLs are validated by `normalizedBase`.
 */
function baseFor(kind: Kind, ctx: AdapterContext, extra: Json): string {
  if (kind === 'openai') return OPENAI_BASE
  const fromSettings = ctx.settings?.baseURL
  const raw =
    typeof fromSettings === 'string' && fromSettings
      ? fromSettings
      : typeof extra.baseURL === 'string'
        ? extra.baseURL
        : ctx.secret('OPENAI_COMPATIBLE_BASE_URL')
  if (!raw) throw new ProviderError('invalid_input', '请填写兼容渠道 Base URL')
  return normalizedBase(raw)
}

/** 兼容渠道的真实模型 ID：宿主设置里的 `model` 优先（宿主可能用自己的身份串做 req.model）。 */
function compatibleModel(ctx: AdapterContext, fallback: string): string {
  const configured = ctx.settings?.model
  return typeof configured === 'string' && configured ? configured : fallback
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function submit(
  req: AdapterRequest,
  ctx: AdapterContext,
  kind: Kind,
  models: ModelDeclaration[],
  options: OpenAIAdapterOptions,
): Promise<SubmitResult> {
  const key = requireKey(kind, ctx)
  const input = req.input as CapabilityInput<'text.chat'> &
    Partial<CapabilityInput<'image.generate'>> &
    Partial<CapabilityInput<'image.edit'>>
  const extra = asJson(input.extra ?? {})
  const base = baseFor(kind, ctx, extra)
  const model =
    kind === 'compatible'
      ? compatibleModel(ctx, modelId(req.model, models))
      : modelId(req.model, models)
  if (kind === 'openai' && !req.remoteOnly) {
    const known = resolveModel(models, req.model)
    if (!known || known.custom || !known.declaration.capabilities.includes(req.capability))
      throw new ProviderError('invalid_input', 'OpenAI 模型不支持该能力，请重新选择模型')
  }
  const tag = label(kind)
  const transport = messages(kind)

  if (req.capability === 'text.chat') {
    const chat = input as CapabilityInput<'text.chat'>
    if (kind === 'openai')
      return responsesChat({
        ctx,
        model,
        apiKey: key,
        label: tag,
        input: chat,
        messages: transport,
        declaration: resolveModel(models, req.model)?.declaration,
        temperatureDisabled:
          resolveModel(models, req.model)?.declaration.limits?.temperature === false,
      })
    return compatibleChat({
      ctx,
      baseURL: base,
      model,
      apiKey: key,
      label: tag,
      input: chat,
      messages: transport,
      structured: ctx.settings?.structured === 'json_schema' ? 'json_schema' : 'json_object',
    })
  }

  if (req.capability === 'image.generate') {
    const built = await buildImageBody(
      model,
      input as CapabilityInput<'image.generate'>,
      ctx,
      tag,
      resolveModel(models, req.model)?.declaration,
    )
    const data = await request({
      ctx,
      url: `${base}${built.edit ? '/images/edits' : '/images/generations'}`,
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify(built.body),
      label: tag,
      messages: transport,
      secrets: [key],
      classify: classifyOpenAI,
      retries: 0,
    })
    return parseImageResponse(data, built.format)
  }

  if (req.capability === 'image.edit') {
    const built = await buildEditBody(
      model,
      input as CapabilityInput<'image.edit'>,
      ctx,
      tag,
      options.editMask,
      resolveModel(models, req.model)?.declaration,
    )
    const data = await request({
      ctx,
      url: `${base}/images/edits`,
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify(built.body),
      label: tag,
      messages: transport,
      secrets: [key],
      classify: classifyOpenAI,
      retries: 0,
    })
    return parseImageResponse(data, built.format)
  }

  throw new ProviderError('invalid_input', `${tag} 不支持此能力：${req.capability}`)
}

function makeAdapter(
  kind: Kind,
  models: ModelDeclaration[],
  options: OpenAIAdapterOptions,
): PlatformAdapter {
  return defineAdapter({
    id: kind === 'openai' ? 'openai/api' : 'openai/compatible',
    title: label(kind),
    channels: [kind === 'openai' ? 'openai' : 'openai-compatible'],
    models,
    nativeOperations: kind === 'openai' ? ['listModels', 'raw-request'] : ['listModels'],
    docsUrl: DOCS,
    nodeOnly: ['node'],
    submit: (req, ctx) => submit(req, ctx, kind, models, options),
    // 官方与兼容渠道的聊天 / 生图都是同步接口，没有异步任务可轮询。
    poll: () =>
      Promise.reject(
        new ProviderError(
          'invalid_input',
          `${label(kind)} 的聊天与图片接口均为同步调用，没有异步任务可轮询`,
        ),
      ),
    native: async (op, params, ctx) => {
      if (kind === 'openai' && op === 'raw-request')
        return responsesRequest(asJson(params), ctx, requireKey(kind, ctx), messages(kind))
      if (op !== 'listModels') throw new ProviderError('invalid_input', `未知的 native 操作：${op}`)
      const key = requireKey(kind, ctx)
      const extra = asJson({})
      const base = baseFor(kind, ctx, extra)
      const data = await request({
        ctx,
        url: `${base}/models`,
        method: 'GET',
        headers: authHeaders(key),
        label: label(kind),
        messages: messages(kind),
        secrets: [key],
        classify: classifyOpenAI,
      })
      // 兼容渠道上的模型都是对话模型，给宿主一个类型提示
      return openAiModelList(data, kind === 'compatible' ? { kind: 'llm' } : {})
    },
  })
}

/**
 * OpenAI 官方渠道适配器工厂。
 *
 * `image.edit` 的蒙版 alpha 转换是 Node 专属能力，由宿主从
 * `@modelbay/openai/node` 注入 `editMask`。
 */
export function createOpenAIAdapter(
  models: ModelDeclaration[],
  options: OpenAIAdapterOptions = {},
): PlatformAdapter {
  return makeAdapter('openai', models, options)
}

/** OpenAI 兼容渠道适配器工厂（与官方渠道同一套注入点）。 */
export function createOpenAICompatibleAdapter(
  models: ModelDeclaration[],
  options: OpenAIAdapterOptions = {},
): PlatformAdapter {
  return makeAdapter('compatible', models, options)
}

/** OpenAI official API adapter (channel `openai`). */
export const openaiAdapter: PlatformAdapter = createOpenAIAdapter(models)
/** OpenAI-compatible channel adapter (channel `openai-compatible`). */
export const openaiCompatibleAdapter: PlatformAdapter = createOpenAICompatibleAdapter(models)
export { openaiPlatform } from './platform'
