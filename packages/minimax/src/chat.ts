/**
 * 对话：手写 /v1/chat/completions（不走 AI SDK）。
 * 看图把 AssetRef 经 ctx.files.read 转 data URI；结构化输出把 Schema 写进指令，
 * 返回后剥离代码围栏并用 z.fromJSONSchema 本地校验。
 */
import {
  ProviderError,
  type AdapterContext,
  type AdapterRequest,
  type AssetRef,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { chatMessages, imageDataUrl } from '@modelbay/shared'
import { z } from 'zod'
import { withFiles } from './files'
import { asJson, arr, requestJson, type Json } from './http'
import { sensitive, usage } from './util'

/** extra 里不允许覆盖的请求字段：模型、输入、流式开关、工具和输出格式由适配器决定 */
const RESERVED = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'tools',
  'tool_choice',
  'response_format',
  'reasoning_split',
])

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/** 参考图 / 人物参考的编码：格式与大小限制按平台要求 */
export function imageData(ctx: AdapterContext, ref: AssetRef, maxMb = 30) {
  const message = `MiniMax 图片格式不支持或超过 ${maxMb} MB`
  return imageDataUrl(withFiles(ctx), ref, {
    notImage: 'MiniMax 参考素材必须是图片',
    accept: (mime) => IMAGE_MIMES.includes(mime),
    badMime: message,
    maxBytes: maxMb * 1024 * 1024,
    tooLarge: message,
  })
}

export async function chat(
  request: AdapterRequest<'text.chat'>,
  model: string,
  spec: ModelDeclaration | undefined,
  ctx: AdapterContext,
): Promise<SubmitResult> {
  const input = request.input
  const vision = spec?.features?.includes('vision') ?? false
  // 未使用平台的严格结构化参数：把 Schema 作为指令发送，返回后仍须校验。
  const structured = Boolean(input.jsonSchema)
  let validator: z.ZodType | null = null
  if (input.jsonSchema) {
    try {
      validator = z.fromJSONSchema(input.jsonSchema as Parameters<typeof z.fromJSONSchema>[0])
    } catch {
      // Schema 用了 zod 不支持的写法时只检查是不是 JSON
    }
  }
  const messages = await chatMessages(input.messages, (ref) => {
    if (!vision) throw new ProviderError('invalid_input', '当前模型不支持图片输入')
    return imageData(ctx, ref)
  })
  if (input.jsonSchema)
    messages.unshift({
      role: 'system',
      content: `Return only valid JSON matching this schema, without Markdown or explanation: ${JSON.stringify(input.jsonSchema)}`,
    })
  const extra = Object.fromEntries(
    Object.entries(input.extra ?? {}).filter(([key]) => !RESERVED.has(key)),
  )
  const body: Json = {
    ...extra,
    model,
    messages,
    stream: false,
    reasoning_split: true,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxTokens !== undefined ? { max_completion_tokens: input.maxTokens } : {}),
  }
  const result = await requestJson(ctx, '/v1/chat/completions', body)
  const choice = asJson(arr(result.choices)[0])
  if (
    sensitive(result.input_sensitive) ||
    sensitive(result.output_sensitive) ||
    choice.finish_reason === 'content_filter'
  )
    throw new ProviderError('content_policy', 'MiniMax 内容审核未通过')
  const text = asJson(choice.message).content
  if (typeof text !== 'string' || !text)
    throw new ProviderError('unknown', 'MiniMax 响应缺少文本', { retryable: false })
  let value: unknown
  if (structured) {
    if (choice.finish_reason === 'length')
      throw new ProviderError('unknown', 'MiniMax 结构化输出被截断，请增加输出长度', {
        retryable: false,
      })
    try {
      const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
      value = validator ? validator.parse(parsed) : parsed
    } catch {
      throw new ProviderError('unknown', 'MiniMax 返回的 JSON 不符合要求，请修改要求或换模型', {
        retryable: false,
      })
    }
  }
  return {
    state: 'succeeded',
    outputs: structured ? [{ type: 'json', value }] : [{ type: 'text', text }],
    usage: usage(result),
  }
}
