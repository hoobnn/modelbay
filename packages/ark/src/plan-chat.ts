/**
 * Agent Plan 的思考续传：AI SDK 的兼容协议会丢弃 `encrypted_content`，
 * 这里在方舟边界从 SSE 流里按增量累积 `reasoning_content` / `encrypted_content`，
 * 之后原样回传给下一轮工具调用。
 */
import { ProviderError, type ChatMessage } from '@modelbay/core'
import { asJson } from './http'

/** 思考续传内容的累积上限（字符数）。 */
const CONTINUATION_BUDGET = 256 * 1024
/** 单条未换行的流式消息上限（字符数）。 */
const LINE_BUDGET = 512 * 1024

export function capturePlanContinuation(
  response: Response,
  continuation: NonNullable<ChatMessage['continuation']>,
): Response {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    return response
  const decoder = new TextDecoder()
  let pending = ''
  const line = (value: string) => {
    if (!value.startsWith('data:')) return
    const raw = value.slice(5).trim()
    if (raw === '[DONE]') return
    let data: Record<string, unknown>
    try {
      data = asJson(JSON.parse(raw))
    } catch {
      return
    }
    const choices = Array.isArray(data.choices) ? data.choices : []
    const delta = asJson(asJson(choices[0]).delta)
    if (typeof delta.reasoning_content === 'string')
      continuation.reasoningContent =
        (continuation.reasoningContent ?? '') + delta.reasoning_content
    if (typeof delta.encrypted_content === 'string')
      continuation.encryptedContent =
        (continuation.encryptedContent ?? '') + delta.encrypted_content
    if (
      (continuation.reasoningContent?.length ?? 0) + (continuation.encryptedContent?.length ?? 0) >
      CONTINUATION_BUDGET
    )
      throw new ProviderError('unknown', '方舟思考续传内容超过预算，未继续调用工具')
  }
  return new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true })
          const lines = pending.split('\n')
          pending = lines.pop()!
          for (const value of lines) line(value)
          if (pending.length > LINE_BUDGET)
            throw new ProviderError('unknown', '方舟流式消息超过预算')
          controller.enqueue(chunk)
        },
        flush() {
          pending += decoder.decode()
          if (pending) line(pending)
        },
      }),
    ),
    { status: response.status, headers: response.headers },
  )
}
