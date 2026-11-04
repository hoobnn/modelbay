/**
 * `@modelbay/openai` — OpenAI and OpenAI-compatible adapters.
 *
 * - `openaiAdapter` (channel `openai`): the official `https://api.openai.com/v1` API.
 * - `openaiCompatibleAdapter` (channel `openai-compatible`): a single custom
 *   Chat Completions channel whose Base URL / model id are supplied by the host.
 *
 * Both use `/chat/completions` for text chat. The root entry is runtime-agnostic;
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
  type PlatformAdapter,
  type SubmitResult,
} from '@modelbay/core'
import { all } from './declarations'
import { chatCompletion } from './chat'
import { asJson, request, type Json, type TransportMessages } from './http'
import { normalizedBase } from './config'
import { buildEditBody, buildImageBody, openAiModelList, parseImageResponse } from './media'

const OPENAI_BASE = 'https://api.openai.com/v1'
const DOCS = 'https://developers.openai.com/api/docs'

type Kind = 'openai' | 'compatible'

/** Channels covered by this package. */
export const channels: string[] = ['openai', 'openai-compatible']
/** All declared models (empty until the declarations task lands). */
export const models = all

function label(kind: Kind): string {
  return kind === 'openai' ? 'OpenAI' : '兼容渠道'
}

function messages(kind: Kind): TransportMessages {
  return {
    cancelled: `${label(kind)}请求已取消；生成提交可能已受理`,
    network: `${label(kind)}网络请求失败；生成提交结果未知，请勿直接重提`,
  }
}

function requireKey(kind: Kind, ctx: AdapterContext): string {
  const name = kind === 'openai' ? 'OPENAI_API_KEY' : 'OPENAI_COMPATIBLE_API_KEY'
  const key = ctx.secret(name)
  if (!key) throw new ProviderError('auth', `请填写 ${name}`)
  return key
}

/** Resolve `渠道:渠道内ID` / canonical id / alias to the platform wire id. */
function modelId(ref: string): string {
  const colon = ref.indexOf(':')
  const raw = colon >= 0 ? ref.slice(colon + 1) : ref
  const found = resolveModel(all, ref)
  return found?.channel.id ?? raw
}

/**
 * Base URL for the compatible channel. `AdapterContext` has no settings slot,
 * so non-secret channel config is conveyed through the same injected
 * `name → value` resolver (`ctx.secret`), with `input.extra.baseURL` as an
 * explicit per-request override. Public URLs are validated by `normalizedBase`.
 */
function baseFor(kind: Kind, ctx: AdapterContext, extra: Json): string {
  if (kind === 'openai') return OPENAI_BASE
  const raw =
    typeof extra.baseURL === 'string' ? extra.baseURL : ctx.secret('OPENAI_COMPATIBLE_BASE_URL')
  if (!raw) throw new ProviderError('invalid_input', '请填写兼容渠道 Base URL')
  return normalizedBase(raw)
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function submit(req: AdapterRequest, ctx: AdapterContext, kind: Kind): Promise<SubmitResult> {
  const key = requireKey(kind, ctx)
  const input = req.input as CapabilityInput<'text.chat'> &
    Partial<CapabilityInput<'image.generate'>> &
    Partial<CapabilityInput<'image.edit'>>
  const extra = asJson(input.extra ?? {})
  const base = baseFor(kind, ctx, extra)
  const model = modelId(req.model)
  const tag = label(kind)
  const transport = messages(kind)

  if (req.capability === 'text.chat') {
    return chatCompletion({
      ctx,
      url: `${base}/chat/completions`,
      model,
      apiKey: key,
      label: tag,
      input: input as CapabilityInput<'text.chat'>,
      messages: transport,
      structured: kind === 'openai' ? 'json_schema' : 'json_object',
      classify: (_status, code) => {
        if (/quota|billing|insufficient_quota/.test(code)) return 'quota'
        if (/content_policy|safety|moderation/.test(code)) return 'content_policy'
        return undefined
      },
    })
  }

  if (req.capability === 'image.generate') {
    const built = await buildImageBody(model, input as CapabilityInput<'image.generate'>, ctx, tag)
    const data = await request({
      ctx,
      url: `${base}${built.edit ? '/images/edits' : '/images/generations'}`,
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify(built.body),
      label: tag,
      messages: transport,
      secrets: [key],
      retries: 0,
    })
    return parseImageResponse(data, built.format)
  }

  if (req.capability === 'image.edit') {
    const built = await buildEditBody(model, input as CapabilityInput<'image.edit'>, ctx, tag)
    const data = await request({
      ctx,
      url: `${base}/images/edits`,
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify(built.body),
      label: tag,
      messages: transport,
      secrets: [key],
      retries: 0,
    })
    return parseImageResponse(data, built.format)
  }

  throw new ProviderError('invalid_input', `${tag} 不支持此能力：${req.capability}`)
}

function makeAdapter(kind: Kind): PlatformAdapter {
  return defineAdapter({
    id: kind === 'openai' ? 'openai/api' : 'openai/compatible',
    title: label(kind),
    channels: [kind === 'openai' ? 'openai' : 'openai-compatible'],
    models,
    nativeOperations: ['listModels'],
    docsUrl: DOCS,
    nodeOnly: ['node'],
    submit: (req, ctx) => submit(req, ctx, kind),
    // 官方与兼容渠道的聊天 / 生图都是同步接口，没有异步任务可轮询。
    poll: () =>
      Promise.reject(
        new ProviderError(
          'invalid_input',
          `${label(kind)} 的聊天与图片接口均为同步调用，没有异步任务可轮询`,
        ),
      ),
    native: async (op, _params, ctx) => {
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
      })
      return openAiModelList(data)
    },
  })
}

/** OpenAI official API adapter (channel `openai`). */
export const openaiAdapter: PlatformAdapter = makeAdapter('openai')
/** OpenAI-compatible channel adapter (channel `openai-compatible`). */
export const openaiCompatibleAdapter: PlatformAdapter = makeAdapter('compatible')
