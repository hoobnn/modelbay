/**
 * OpenAI-compatible `/chat/completions` request builder and response parser.
 * Platform-specific fields (thinking, web search, previous_response_id, ...)
 * are passed through verbatim from `input.extra`; structured continuation fields
 * on assistant messages are converted back to the platform wire format.
 */
import {
  ProviderError,
  toBase64,
  type AdapterContext,
  type AssetRef,
  type CapabilityInput,
  type ChatMessage,
  type ChatToolCall,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, request, type ErrorClassifier, type Json, type TransportMessages } from './http'

/** Fields controlled by the adapter; `input.extra` cannot override them. */
export const RESERVED = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'tools',
  'tool_choice',
  'response_format',
  'temperature',
  'max_tokens',
  'n',
  'baseURL',
])

function textOf(content: ChatMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
}

/** Turn an asset reference into a base64 data URL the platform can read. */
export async function imageDataUrl(
  ctx: AdapterContext,
  ref: AssetRef,
  label: string,
): Promise<string> {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', `${label} 需要宿主注入 assets 才能发送图片`)
  const asset = await ctx.assets.load(ref.assetId)
  return `data:${asset.mime};base64,${toBase64(asset.data)}`
}

/** Convert normalized chat messages into OpenAI-compatible wire messages. */
export async function buildMessages(
  ctx: AdapterContext,
  input: CapabilityInput<'text.chat'>,
  label: string,
): Promise<Json[]> {
  const out: Json[] = []
  for (const message of input.messages) {
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        ...(message.toolName ? { name: message.toolName } : {}),
        content: textOf(message.content),
      })
      continue
    }
    if (message.role === 'assistant') {
      const wire: Json = { role: 'assistant', content: textOf(message.content) }
      if (message.toolCalls?.length) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }))
      }
      // 思考续传：回传平台要求的加密 / 推理内容，不作为助手正文显示
      const continuation = message.continuation
      if (continuation) {
        if (continuation.encryptedContent) wire.encrypted_content = continuation.encryptedContent
        if (continuation.reasoningContent) wire.reasoning_content = continuation.reasoningContent
      }
      out.push(wire)
      continue
    }
    if (message.role === 'system') {
      out.push({ role: 'system', content: textOf(message.content) })
      continue
    }
    if (typeof message.content === 'string') {
      out.push({ role: 'user', content: message.content })
      continue
    }
    out.push({
      role: 'user',
      content: await Promise.all(
        message.content.map(async (part) =>
          part.type === 'text'
            ? { type: 'text', text: part.text }
            : {
                type: 'image_url',
                image_url: { url: await imageDataUrl(ctx, part.image, label) },
              },
        ),
      ),
    })
  }
  return out
}

export interface ChatCall {
  ctx: AdapterContext
  /** Full `/chat/completions` URL. */
  url: string
  model: string
  apiKey: string
  label: string
  input: CapabilityInput<'text.chat'>
  messages: TransportMessages
  structured?: 'json_schema' | 'json_object' | 'none'
  classify?: ErrorClassifier
  /** Extra body fields injected by the channel (e.g. store / include). */
  providerFields?: Json
}

/** Build the JSON body; non-reserved `extra` keys are forwarded unchanged. */
export function buildChatBody(call: ChatCall, wireMessages: Json[]): Json {
  const { input, model } = call
  const extra: Json = {}
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (!RESERVED.has(key)) extra[key] = value
  }
  const body: Json = {
    ...extra,
    ...call.providerFields,
    model,
    messages: wireMessages,
    stream: false,
  }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens
  if (input.tools?.length) {
    body.tools = input.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    body.tool_choice = input.toolChoice ?? 'auto'
  }
  if (input.jsonSchema) {
    if (call.structured === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'modelbay_output', schema: input.jsonSchema },
      }
    } else {
      body.response_format = { type: 'json_object' }
      wireMessages.unshift({
        role: 'system',
        content: `Return only JSON matching this schema: ${JSON.stringify(input.jsonSchema)}`,
      })
    }
  }
  return body
}

/** Parse a Chat Completions response into normalized outputs + usage. */
export function parseChatResponse(call: ChatCall, value: Json): SubmitResult {
  const choices = Array.isArray(value.choices) ? value.choices : []
  const first = asJson(choices[0])
  const message = asJson(first.message ?? first.delta)
  const text = typeof message.content === 'string' ? message.content : ''
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const calls: ChatToolCall[] = rawCalls.map((entry) => {
    const item = asJson(entry)
    const fn = asJson(item.function)
    let args: Record<string, unknown> = {}
    try {
      args = asJson(JSON.parse(String(fn.arguments ?? '{}')))
    } catch {
      args = {}
    }
    return { id: String(item.id ?? ''), name: String(fn.name ?? ''), arguments: args }
  })
  const finish = first.finish_reason ?? first.finishReason
  if (finish === 'content_filter')
    throw new ProviderError('content_policy', `${call.label} 拒绝生成此内容`)

  const encrypted =
    typeof message.encrypted_content === 'string' ? message.encrypted_content : undefined
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : undefined
  const continuation =
    encrypted || reasoning
      ? {
          model: call.model,
          ...(reasoning ? { reasoningContent: reasoning } : {}),
          ...(encrypted ? { encryptedContent: encrypted } : {}),
        }
      : undefined

  const outputs: ProviderOutput[] = []
  if (call.input.jsonSchema) {
    try {
      outputs.push({ type: 'json', value: JSON.parse(text) })
    } catch (cause) {
      throw new ProviderError('unknown', `${call.label} 返回的结构化内容不是有效 JSON`, { cause })
    }
  } else {
    if (text) outputs.push({ type: 'text', text })
    if (calls.length)
      outputs.push({ type: 'tool_calls', calls, ...(continuation ? { continuation } : {}) })
  }
  if (!outputs.length) throw new ProviderError('unknown', `${call.label} 响应缺少对话内容`)

  const usage = asJson(value.usage)
  return {
    state: 'succeeded',
    outputs,
    usage: {
      ...(typeof usage.prompt_tokens === 'number'
        ? { inputTokens: usage.prompt_tokens as number }
        : {}),
      ...(typeof usage.completion_tokens === 'number'
        ? { outputTokens: usage.completion_tokens as number }
        : {}),
    },
  }
}

/** Submit one chat completion. POST is never retried (the platform may bill it). */
export async function chatCompletion(call: ChatCall): Promise<SubmitResult> {
  if (!call.input.messages.length)
    throw new ProviderError('invalid_input', `${call.label} 对话至少需要一条消息`)
  const wireMessages = await buildMessages(call.ctx, call.input, call.label)
  const body = buildChatBody(call, wireMessages)
  const data = await request({
    ctx: call.ctx,
    url: call.url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    label: call.label,
    messages: call.messages,
    secrets: [call.apiKey],
    classify: call.classify,
    retries: 0,
  })
  return parseChatResponse(call, data)
}
