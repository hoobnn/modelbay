/**
 * DeepSeek /responses is stateless. Terminal SSE event carries the complete
 * output and usage; reasoning_text is replayed with client-side tool results.
 * Sources checked 2026-11-13:
 * https://api-docs.deepseek.com/api/create-response/
 * https://api-docs.deepseek.com/guides/web_tools/
 */
import {
  ProviderError,
  type AdapterContext,
  type AdapterRequest,
  type ChatMessage,
  type ChatToolCall,
  type ModelDeclaration,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import { asJson } from '@modelbay/shared'
import { z } from 'zod'
import { errorInfo, sendRequest } from './http'
import { imageUrl } from './chat'

type Json = Record<string, unknown>
const objects = (value: unknown): Json[] => (Array.isArray(value) ? value.map(asJson) : [])
const text = (content: ChatMessage['content']) =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('')
function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}
function unknown(message: string, cause?: unknown): never {
  throw new ProviderError('unknown', message, { outcome: 'unknown', retryable: false, cause })
}

async function toInput(request: AdapterRequest<'text.chat'>, ctx: AdapterContext): Promise<Json[]> {
  const items: Json[] = []
  for (const message of request.input.messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId) invalid('工具结果缺少 toolCallId')
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: text(message.content),
      })
      continue
    }
    if (
      message.role === 'assistant' &&
      message.continuation?.model === request.model &&
      message.continuation.reasoningContent
    )
      items.push({
        type: 'reasoning',
        content: [{ type: 'reasoning_text', text: message.continuation.reasoningContent }],
      })
    if (typeof message.content === 'string') {
      if (message.content || !message.toolCalls?.length)
        items.push({ role: message.role, content: message.content })
    } else {
      if (message.role === 'assistant' && message.content.some((p) => p.type === 'image'))
        invalid('DeepSeek 不接受 assistant 图片消息')
      items.push({
        role: message.role,
        content: await Promise.all(
          message.content.map(async (p) =>
            p.type === 'text'
              ? { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: p.text }
              : { type: 'input_image', image_url: await imageUrl(ctx, p.image) },
          ),
        ),
      })
    }
    for (const call of message.toolCalls ?? [])
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })
  }
  return items
}

export async function responsesBody(
  request: AdapterRequest<'text.chat'>,
  ctx: AdapterContext,
): Promise<Json> {
  const { input } = request
  const extra = { ...input.extra }
  const web = Boolean(extra.web_search || extra.read_url)
  if ((web || asJson(extra.safety_check).level === 'high') && input.jsonSchema)
    invalid('DeepSeek 联网工具或高等级内容审核不支持结构化输出')
  if (web && extra.top_logprobs !== undefined) invalid('DeepSeek 联网工具不支持 top_logprobs')
  if (extra.stop !== undefined || extra.logprobs !== undefined)
    invalid('DeepSeek Responses API 不支持 stop 或 logprobs；请使用 Chat Completions')
  const items = await toInput(request, ctx)
  if (extra.web_history !== undefined) {
    // Arbitrary insertion loses round boundaries. Raw Responses accepts complete history.
    invalid('联网多轮历史请使用 native responses 原样回传完整 input 和 output')
  }
  const tools: Json[] = (input.tools ?? []).map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
  if (extra.web_search) tools.push({ type: 'deepseek_web_search' })
  if (extra.read_url) tools.push({ type: 'deepseek_read_url' })
  let effort = extra.reasoning_effort
  const thinking = asJson(extra.thinking)
  if (thinking.type === 'disabled') effort = 'none'
  else if (thinking.type === 'enabled' && effort === 'none') effort = undefined
  const body: Json = { model: request.model, input: items, stream: true }
  for (const key of ['top_p', 'top_logprobs', 'user', 'safety_check', 'title'])
    if (extra[key] !== undefined) body[key] = extra[key]
  if (effort !== undefined) body.reasoning = { effort }
  if (tools.length) body.tools = tools
  if (input.toolChoice) body.tool_choice = input.toolChoice
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTokens !== undefined) body.max_output_tokens = input.maxTokens
  if (input.jsonSchema)
    body.text = {
      format: { type: 'json_schema', name: 'modelbay_output', schema: input.jsonSchema },
    }
  return body
}

/** Read incrementally, accepting keep-alive comments and arbitrary byte boundaries. */
export async function terminalResponse(response: Response, ctx: AdapterContext): Promise<Json> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    unknown('DeepSeek Responses 未返回 SSE 数据')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let terminal: Json | undefined
  const frame = (value: string) => {
    const raw = value
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!raw) return
    let data: Json
    try {
      data = asJson(JSON.parse(raw))
    } catch (cause) {
      unknown('DeepSeek Responses SSE 数据无法解析', cause)
    }
    if (data.type === 'error' || data.error) throw errorInfo(data.error ?? data, 200, ctx)
    if (data.type === 'response.output_text.delta' && typeof data.delta === 'string')
      ctx.stream?.({ text: data.delta })
    if (
      ['response.completed', 'response.incomplete', 'response.failed'].includes(String(data.type))
    )
      terminal = asJson(data.response)
  }
  try {
    for (;;) {
      const next = await reader.read()
      pending += decoder.decode(next.value, { stream: !next.done })
      let match: RegExpExecArray | null
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        frame(pending.slice(0, match.index))
        pending = pending.slice(match.index + match[0].length)
      }
      if (next.done) break
    }
    if (pending.trim()) frame(pending)
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause
    if (ctx.signal.aborted)
      throw new ProviderError('cancelled', 'DeepSeek 对话已取消；结果可能未知', {
        cause,
        outcome: 'unknown',
        retryable: false,
      })
    unknown('DeepSeek Responses 流中断；请勿自动重新提交', cause)
  } finally {
    reader.releaseLock()
  }
  if (!terminal) unknown('DeepSeek Responses 缺少终止事件；请勿自动重新提交')
  return terminal
}

export async function responsesChat(
  request: AdapterRequest<'text.chat'>,
  ctx: AdapterContext,
  _model: ModelDeclaration,
): Promise<SubmitResult> {
  const body = await responsesBody(request, ctx)
  const response = await sendRequest(ctx, '/responses', 'POST', JSON.stringify(body), {
    'Content-Type': 'application/json',
  })
  const data = await terminalResponse(response, ctx)
  const reason = asJson(data.incomplete_details).reason
  if (reason === 'content_filter')
    throw new ProviderError('content_policy', 'DeepSeek 拒绝生成此内容')
  if (data.status === 'failed' || data.error) throw errorInfo(data.error ?? data, 200, ctx)
  if (!['completed', 'incomplete'].includes(String(data.status)))
    unknown('DeepSeek Responses 终包状态无效')
  const calls: ChatToolCall[] = []
  let answer = ''
  let reasoning = ''
  const citations: Json[] = []
  const web: Json[] = []
  for (const item of objects(data.output)) {
    if (item.type === 'web_search_call') web.push(item)
    if (item.type === 'function_call') {
      try {
        const args: unknown = JSON.parse(String(item.arguments))
        if (
          !args ||
          typeof args !== 'object' ||
          Array.isArray(args) ||
          typeof item.call_id !== 'string' ||
          typeof item.name !== 'string'
        )
          unknown('DeepSeek 工具调用字段无效')
        calls.push({ id: item.call_id, name: item.name, arguments: args as Json })
      } catch (cause) {
        if (cause instanceof ProviderError) throw cause
        unknown('DeepSeek 工具调用参数不是 JSON 对象', cause)
      }
    }
    for (const part of objects(item.content)) {
      if (part.type === 'refusal')
        throw new ProviderError('content_policy', 'DeepSeek 拒绝生成此内容')
      if (part.type === 'output_text' && typeof part.text === 'string') {
        answer += part.text
        citations.push(...objects(part.annotations))
      }
      if (part.type === 'reasoning_text' && typeof part.text === 'string') reasoning += part.text
    }
  }
  if (!answer && !calls.length) unknown('DeepSeek Responses 缺少对话内容')
  const outputs: ProviderOutput[] = []
  if (request.input.jsonSchema) {
    if (data.status === 'incomplete') unknown('DeepSeek 结构化输出被截断')
    try {
      const value: unknown = JSON.parse(answer)
      const validator = z.fromJSONSchema(request.input.jsonSchema)
      outputs.push({ type: 'json', value: validator.parse(value) })
    } catch (cause) {
      unknown('DeepSeek 返回的 JSON 不符合 Schema', cause)
    }
  } else if (answer) outputs.push({ type: 'text', text: answer })
  if (calls.length)
    outputs.push({
      type: 'tool_calls',
      calls,
      ...(reasoning ? { continuation: { model: request.model, reasoningContent: reasoning } } : {}),
    })
  const usage = asJson(data.usage)
  if (web.length || citations.length || data.title !== undefined || data.status === 'incomplete')
    outputs.push({
      type: 'json',
      value: {
        response_id: data.id,
        status: data.status,
        web_searches: web,
        citations,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(reason !== undefined ? { incomplete_reason: reason } : {}),
        ...(usage.server_tool_use !== undefined ? { server_tool_use: usage.server_tool_use } : {}),
      },
    })
  return {
    state: 'succeeded',
    outputs,
    usage: {
      ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
    },
  }
}
