/**
 * 方舟 `/chat/completions`：请求构造与响应解析交给 `@modelbay/shared` 的流式对话层
 * （Vercel AI SDK，边生成边回调 `ctx.stream`，流必须以 `[DONE]` 结束）；
 * 这里只提供鉴权 fetch、错误归类、`extra` 白名单与 Agent Plan 的思考续传。
 */
import {
  ProviderError,
  type AdapterContext,
  type CapabilityInput,
  type ChatMessage,
  type SubmitResult,
} from '@modelbay/core'
import { chatCompletion as sharedChat, requireSseDone } from '@modelbay/shared'
import { imageData } from './files'
import {
  asJson,
  errorInfo,
  readJson,
  send,
  withRetry,
  type Json,
  type TransportMessages,
} from './http'
import { capturePlanContinuation } from './plan-chat'

/**
 * `input.extra` 在对话里只放行这些平台字段；其余一律报错，不能覆盖模型 / 输入 / 路由。
 * 前四项是通用参数；后三项是 MCP 目录 `chat` 工具承诺的参数（缓存路由标识、联网搜索、续接响应）。
 */
export const CHAT_EXTRA = [
  'thinking',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'prompt_cache_key',
  'web_search',
  'previous_response_id',
]

/** 按白名单检查 `extra`，返回副本；出现白名单外的键时抛 invalid_input。 */
export function extraParams(extra: Json | undefined, allowed: string[]): Json {
  for (const key of Object.keys(extra ?? {})) {
    if (!allowed.includes(key))
      throw new ProviderError(
        'invalid_input',
        `火山方舟不支持 extra.${key}；不能覆盖模型、输入或请求路由`,
      )
  }
  return { ...extra }
}

export interface ChatCall {
  ctx: AdapterContext
  /** `/chat/completions` 之前的那一段，如 `https://ark.cn-beijing.volces.com/api/v3` */
  baseURL: string
  /** 请求体里的模型名（套餐为套餐模型名，自定义槽为 Endpoint ID） */
  model: string
  apiKey: string
  label: string
  input: CapabilityInput<'text.chat'>
  /** Agent Plan：保存并回传思考摘要 / 加密续传内容 */
  plan: boolean
}

export async function chatCompletion(call: ChatCall): Promise<SubmitResult> {
  const { ctx, input, apiKey: key, label } = call
  if (!input.messages.length) throw new ProviderError('invalid_input', `对话至少需要一条消息`)
  extraParams(input.extra, CHAT_EXTRA)
  const messages: TransportMessages = {
    cancelled: `${label}请求已取消`,
    network: `${label}网络请求失败；对话结果可能未知，不会自动重新提交`,
  }
  const continuation: NonNullable<ChatMessage['continuation']> = { model: call.model }
  const result = await sharedChat({
    ctx,
    label,
    baseURL: call.baseURL,
    // 鉴权、传输失败和 HTTP 错误码归类走这里；流必须以 [DONE] 结束
    fetch: async (url, init) => {
      const body = asJson(JSON.parse(String(init?.body)))
      if (call.plan && Array.isArray(body.messages)) {
        body.messages = body.messages.map((message, index) => {
          const saved = input.messages[index]?.continuation
          return saved?.model === continuation.model && asJson(message).role === 'assistant'
            ? {
                ...asJson(message),
                ...(saved.reasoningContent ? { reasoning_content: saved.reasoningContent } : {}),
                ...(saved.encryptedContent ? { encrypted_content: saved.encryptedContent } : {}),
              }
            : message
        })
      }
      const res = await send(
        ctx,
        String(url),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        messages,
      )
      if (!res.ok) {
        const data = await readJson(ctx, res, 'POST', messages)
        throw withRetry(errorInfo(asJson(data).error, res.status, label, [key]), 'POST')
      }
      return requireSseDone(
        call.plan ? capturePlanContinuation(res, continuation) : res,
        () => new ProviderError('unknown', `${label}回答不完整或未收到 [DONE]；请勿自动重新提交`),
      )
    },
    model: call.model,
    input,
    image: (ref) => imageData(ctx, ref),
    structured: 'json_schema',
    streamError: (error) => withRetry(errorInfo(error, 200, label, [key]), 'POST'),
  })
  if (call.plan && (continuation.reasoningContent || continuation.encryptedContent))
    for (const output of result.outputs)
      if (output.type === 'tool_calls') output.continuation = continuation
  return result
}
