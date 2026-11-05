/**
 * text.chat 的两条实现：官方渠道走 `/responses`（Vercel AI SDK 的 Responses 语义，
 * 加密思考续传 + 终包完整性校验），兼容渠道走共享 Chat Completions（流式 + [DONE]）。
 * 两者都经 `@modelbay/shared` 的 `chatCompletion`：消息转换、结构化输出校验、
 * 流式读取与用量归一化在 shared，鉴权 / 端点 / 错误归类由这里注入。
 */
import { createOpenAI } from '@ai-sdk/openai'
import {
  ProviderError,
  toBase64,
  type AdapterContext,
  type AssetRef,
  type CapabilityInput,
  type ProviderErrorCode,
  type SubmitResult,
} from '@modelbay/core'
import { chatCompletion, requireSseDone } from '@modelbay/shared'
import { asJson, readJson, send, withRetry, type TransportMessages } from './http'

/** 官方渠道的固定前缀；兼容渠道的 Base URL 由宿主配置提供。 */
export const OPENAI_BASE = 'https://api.openai.com/v1'

interface ImageRule {
  notImage: string
  accept(mime: string): boolean
  badMime: string
  maxBytes: number
  tooLarge: string
}

const IMAGE_RULE: ImageRule = {
  notImage: 'OpenAI 只接受图片资产',
  accept: (mime) => ['image/png', 'image/jpeg', 'image/webp'].includes(mime),
  badMime: 'OpenAI 图片须为 PNG、JPEG 或 WebP',
  maxBytes: 14 * 1024 * 1024,
  tooLarge: 'OpenAI 图片为空或超过本地 14 MiB 限制',
}

/** 兼容渠道的图片规则：多接受 GIF，上限 20 MiB。 */
const COMPATIBLE_IMAGE_RULE: ImageRule = {
  notImage: '兼容渠道只接受图片资产',
  accept: (mime) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime),
  badMime: '兼容渠道图片须为 PNG、JPEG、WebP 或 GIF',
  maxBytes: 20 * 1024 * 1024,
  tooLarge: '兼容渠道图片为空或超过 20 MiB',
}

/** 读一张图片：优先 plein 形状的 `ctx.files`（带媒体元数据），回退到 modelbay 的 assets。 */
async function readImage(
  ctx: AdapterContext,
  ref: AssetRef,
  label: string,
): Promise<{ data: Uint8Array; mime: string }> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets)
    throw new ProviderError('invalid_input', `${label} 需要宿主注入 files 或 assets 才能发送图片`)
  return ctx.assets.load(ref.assetId)
}

/** 把资产引用变成平台能读的 data URL，本地按官方规则校验类型与大小。 */
export async function imageDataUrl(
  ctx: AdapterContext,
  ref: AssetRef,
  label: string,
  rule: ImageRule = IMAGE_RULE,
): Promise<string> {
  if (ref.kind !== 'image') throw new ProviderError('invalid_input', rule.notImage)
  const file = await readImage(ctx, ref, label)
  const mime = file.mime.toLowerCase()
  if (!rule.accept(mime)) throw new ProviderError('invalid_input', rule.badMime)
  if (!file.data.length || file.data.length > rule.maxBytes)
    throw new ProviderError('invalid_input', rule.tooLarge)
  return `data:${mime};base64,${toBase64(file.data)}`
}

/** plein 官方渠道的错误归类：quota / auth / content_policy 之外按状态码走通用链。 */
export function classifyOpenAI(
  _status: number,
  code: string,
  _signal: string,
): ProviderErrorCode | undefined {
  if (/quota|billing|insufficient/.test(code)) return 'quota'
  if (/content_policy|safety|moderation/.test(code)) return 'content_policy'
  return undefined
}

function errorText(
  call: ErrorCall,
  status: number,
  value: unknown,
): { code: string; message: string } {
  const root = asJson(value)
  const error = asJson(root.error)
  const code = String(error.code ?? error.type ?? '').toLowerCase()
  const message = String(error.message ?? `${call.label} HTTP ${status}`)
  return {
    code,
    message: redactKeys(message, call.apiKey),
  }
}

/** plein 的脱敏规则：密钥与其去空白形态都替换成 [redacted]，并清掉 Bearer / sk- 令牌。 */
function redactKeys(text: string, apiKey: string): string {
  const mask = '[redacted]'
  let out = text
  for (const secret of [apiKey, apiKey.trim()].sort((a, b) => b.length - a.length)) {
    if (secret) out = out.split(secret).join(mask)
  }
  return out.replace(/Bearer\s+\S+/gi, `Bearer ${mask}`).replace(/sk-[a-zA-Z0-9_-]+/g, mask)
}

interface ErrorCall {
  apiKey: string
  label: string
}

/** plein 官方渠道的 remoteError：按 code 与状态归类，POST 不可重试。 */
function remoteError(call: ErrorCall, status: number, value: unknown): ProviderError {
  const { code, message } = errorText(call, status, value)
  const category: ProviderErrorCode = /quota|billing|insufficient/.test(code)
    ? 'quota'
    : status === 401 || status === 403
      ? 'auth'
      : /content_policy|safety|moderation/.test(code)
        ? 'content_policy'
        : status === 429
          ? 'rate_limit'
          : status === 408 || status === 504
            ? 'timeout'
            : status >= 500
              ? 'unavailable'
              : status >= 400
                ? 'invalid_input'
                : 'unknown'
  return withRetry(new ProviderError(category, message), 'POST', status)
}

/** plein 兼容渠道的 remoteError：code 优先于状态码，规则与官方渠道不同。 */
function compatibleRemoteError(call: ErrorCall, status: number, value: unknown): ProviderError {
  const root = asJson(value)
  const error = asJson(root.error)
  const code = String(error.code ?? root.code ?? '').toLowerCase()
  const message = String(error.message ?? root.message ?? `兼容渠道 HTTP ${status}`)
  const normalized: ProviderErrorCode =
    status === 401 || status === 403
      ? 'auth'
      : /quota|insufficient|balance/.test(code)
        ? 'quota'
        : /content|safety|policy/.test(code)
          ? 'content_policy'
          : status === 429
            ? 'rate_limit'
            : status === 408 || status === 504
              ? 'timeout'
              : status >= 500
                ? 'unavailable'
                : status >= 400
                  ? 'invalid_input'
                  : 'unknown'
  return withRetry(new ProviderError(normalized, redactKeys(message, call.apiKey)), 'POST', status)
}

/**
 * 不能把截断的 Responses SSE 当作成功；SDK 负责解释终包里的业务状态。
 * 事件流必须收到 response.completed / incomplete / failed / error 之一。
 */
export function terminalResponse(res: Response): Response {
  if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) return res
  const decoder = new TextDecoder()
  let pending = ''
  let terminal = false
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const item = JSON.parse(line.slice(5))
            if (
              ['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(
                item.type,
              )
            )
              terminal = true
          } catch {
            /* SDK reports malformed events. */
          }
        }
        controller.enqueue(chunk)
      },
      flush(controller) {
        if (!terminal)
          controller.error(
            new ProviderError('unknown', 'OpenAI 回答不完整，未收到结束事件；请勿直接重提', {
              outcome: 'unknown',
              retryable: false,
            }),
          )
      },
    }),
  )
  return new Response(body, { status: res.status, headers: res.headers })
}

export interface ResponsesChatCall {
  ctx: AdapterContext
  /** 渠道内的模型 ID（已按声明解析）。 */
  model: string
  apiKey: string
  label: string
  input: CapabilityInput<'text.chat'>
  messages: TransportMessages
  /** 声明 `limits.temperature: false` 时不发送节点默认温度。 */
  temperatureDisabled?: boolean
}

/**
 * 官方渠道 text.chat：`/responses` + `store: false` +
 * `include: ['reasoning.encrypted_content']`（无状态工具循环的加密思考续传）。
 */
export async function responsesChat(call: ResponsesChatCall): Promise<SubmitResult> {
  const effort = asJson(call.input.extra).reasoning_effort
  if (effort !== undefined && !['low', 'medium', 'high'].includes(String(effort)))
    throw new ProviderError('invalid_input', 'OpenAI 思考强度无效')
  const fetchImpl = responsesFetch(call)
  const api = createOpenAI({ apiKey: call.apiKey, baseURL: OPENAI_BASE, fetch: fetchImpl })
  return chatCompletion({
    ctx: call.ctx,
    label: call.label,
    baseURL: OPENAI_BASE,
    model: call.model,
    languageModel: api.responses(call.model),
    openaiResponses: true,
    // 推理模型不支持普通温度采样；声明 temperature:false 时不发送节点默认 temperature。
    input: {
      ...call.input,
      temperature: call.temperatureDisabled ? undefined : call.input.temperature,
    },
    structured: 'json_schema',
    image: (ref) => imageDataUrl(call.ctx, ref, call.label),
    providerOptions: {
      openai: {
        store: false,
        include: ['reasoning.encrypted_content'],
        ...(effort ? { reasoningEffort: String(effort) } : {}),
      },
    },
    fetch: fetchImpl,
    streamError: (error) => remoteError(call, 200, { error }),
  })
}

function responsesFetch(call: ResponsesChatCall): typeof fetch {
  return async (url, init) => {
    if (String(url) !== `${OPENAI_BASE}/responses`)
      throw new ProviderError('invalid_input', 'OpenAI 请求地址无效')
    const res = await send(
      call.ctx,
      String(url),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
        body: String(init?.body),
      },
      call.messages,
    )
    if (!res.ok)
      throw remoteError(call, res.status, await readJson(call.ctx, res, 'POST', call.messages))
    return terminalResponse(res)
  }
}

export interface CompatibleChatCall {
  ctx: AdapterContext
  /** 含协议前缀的 Base URL（如 https://gateway.example.com/v1），无尾斜杠。 */
  baseURL: string
  /** 渠道上的真实模型 ID。 */
  model: string
  apiKey: string
  label: string
  input: CapabilityInput<'text.chat'>
  messages: TransportMessages
  /** 宿主声明的结构化档位；`json_schema` 随请求发 Schema，其余只要求 JSON。 */
  structured?: 'json_schema' | 'json_object'
}

function omitBaseURL(extra: Record<string, unknown>): Record<string, unknown> {
  const { baseURL: _baseURL, ...rest } = extra
  return rest
}

/** 兼容渠道 text.chat：流式 Chat Completions，SSE 必须以 [DONE] 结束。 */
export async function compatibleChat(call: CompatibleChatCall): Promise<SubmitResult> {
  return chatCompletion({
    ctx: call.ctx,
    label: call.label,
    baseURL: call.baseURL,
    model: call.model,
    // `baseURL` 是适配器的单次请求覆盖项，不属于上游请求体
    input: call.input.extra ? { ...call.input, extra: omitBaseURL(call.input.extra) } : call.input,
    structured: call.structured === 'json_schema' ? 'json_schema' : 'json_object',
    image: (ref) => imageDataUrl(call.ctx, ref, call.label, COMPATIBLE_IMAGE_RULE),
    streamError: (error) => compatibleRemoteError(call, 200, { error }),
    fetch: async (url, init) => {
      if (String(url) !== `${call.baseURL}/chat/completions`)
        throw new ProviderError('invalid_input', '兼容渠道请求地址与配置不一致')
      const res = await send(
        call.ctx,
        String(url),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
          body: String(init?.body),
        },
        call.messages,
      )
      if (!res.ok)
        throw compatibleRemoteError(
          call,
          res.status,
          await readJson(call.ctx, res, 'POST', call.messages),
        )
      return requireSseDone(
        res,
        () =>
          new ProviderError('unknown', `${call.label}回答不完整，未收到 [DONE]；请勿直接重提`, {
            outcome: 'unknown',
          }),
      )
    },
  })
}
