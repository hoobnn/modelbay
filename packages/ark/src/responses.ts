/**
 * 方舟 Responses API（`POST /responses`）上的 text.chat：联网搜索（`web_search` 工具）、
 * 续接响应（`previous_response_id`）和最大工具调用轮次（`max_tool_calls`）。
 *
 * 只有请求里带了这三项之一才走这条路；其余对话仍走流式 `/chat/completions`。
 * 这条路用官方默认的非流式（`stream: false`）：整段回答生成完才返回。
 *
 * 字段来源（2026-11-06 核对原文）：
 * - 创建模型响应：https://docs.volcengine.com/docs/82379/1569618
 * - 联网搜索工具：https://docs.volcengine.com/docs/82379/1756990
 *
 * 哪些模型可用由声明的 `optionsSchema` 决定，这里不写型号。
 */
import {
  ProviderError,
  type AdapterContext,
  type CapabilityInput,
  type ChatMessage,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { imageData } from './files'
import { asJson, isJson, request, type Json, type TransportMessages } from './http'
import { optionKeys, validateOptions } from './options'

/** 只有 Responses API 支持的字段；出现任一项就走 `/responses`。 */
export const RESPONSES_ONLY = ['web_search', 'previous_response_id', 'max_tool_calls']

/** Responses API 与 Chat API 都有、对话里放行的通用字段（`top_p` 等）。 */
const SHARED_EXTRA = ['thinking', 'top_p', 'prompt_cache_key']

/** Chat API 有、Responses API 请求参数里没有的字段：明确报错，不静默丢弃。 */
const CHAT_ONLY = ['frequency_penalty', 'presence_penalty']

export function usesResponses(extra: Json | undefined): boolean {
  return RESPONSES_ONLY.some((key) => extra?.[key] !== undefined)
}

export interface ResponsesCall {
  ctx: AdapterContext
  baseURL: string
  model: string
  apiKey: string
  label: string
  input: CapabilityInput<'text.chat'>
  messages: TransportMessages
  declaration?: ModelDeclaration
  /** 套餐渠道不走 Responses。 */
  plan: boolean
}

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

/** `web_search: true` 等价于空对象（用默认设置）；返回 undefined 表示不启用。 */
function searchConfig(value: unknown): Json | undefined {
  if (value === undefined || value === false) return undefined
  if (value === true) return {}
  if (!isJson(value)) invalid('web_search 必须是对象或布尔值')
  return value
}

async function toInput(ctx: AdapterContext, messages: ChatMessage[]): Promise<Json[]> {
  const text = (content: ChatMessage['content']) =>
    typeof content === 'string'
      ? content
      : content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  return Promise.all(
    messages.map(async (message): Promise<Json> => {
      if (message.role === 'tool' || message.toolCalls?.length)
        invalid('联网搜索 / 续接响应的对话暂不支持工具调用消息')
      if (typeof message.content === 'string' || message.role !== 'user')
        return { role: message.role, content: text(message.content) }
      return {
        role: 'user',
        content: await Promise.all(
          message.content.map(async (part) =>
            part.type === 'text'
              ? { type: 'input_text', text: part.text }
              : { type: 'input_image', image_url: await imageData(ctx, part.image) },
          ),
        ),
      }
    }),
  )
}

/** 按声明校验并构造 `/responses` 请求体。 */
export async function responsesBody(call: ResponsesCall): Promise<Json> {
  const { input, declaration } = call
  if (call.plan) invalid('联网搜索 / 续接响应只支持按量渠道的 Responses API，套餐渠道不支持')
  if (!input.messages.length) invalid('对话至少需要一条消息')
  if (input.tools?.length) invalid('联网搜索 / 续接响应的对话暂不支持自定义工具')
  if (input.jsonSchema) invalid('联网搜索 / 续接响应的对话暂不支持结构化输出')
  const extra = asJson(input.extra)
  const declared = optionKeys(declaration)
  for (const key of Object.keys(extra)) {
    if (CHAT_ONLY.includes(key)) invalid(`Responses API 不支持 extra.${key}`)
    if (SHARED_EXTRA.includes(key)) continue
    if (!RESPONSES_ONLY.includes(key))
      invalid(`火山方舟不支持 extra.${key}；不能覆盖模型、输入或请求路由`)
    if (!declared.includes(key)) invalid(`所选模型未声明支持 ${key}（见模型声明的 optionsSchema）`)
  }
  const search = searchConfig(extra.web_search)
  validateOptions(declaration, { ...extra, ...(search ? { web_search: search } : {}) })
  if (search) {
    const sources = search.sources
    if (Array.isArray(sources) && sources.includes('doubao') && sources.length > 1)
      invalid('web_search.sources 里的 doubao 不能与其他搜索来源同时配置')
  }
  const rest = { ...extra }
  delete rest.web_search
  return {
    ...rest,
    model: call.model,
    input: await toInput(call.ctx, input.messages),
    ...(search ? { tools: [{ type: 'web_search', ...search }] } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxTokens !== undefined ? { max_output_tokens: input.maxTokens } : {}),
  }
}

interface Parsed {
  text: string
  citations: Json[]
  searches: Json[]
}

function parseOutput(output: unknown): Parsed {
  const parsed: Parsed = { text: '', citations: [], searches: [] }
  for (const item of Array.isArray(output) ? output.map(asJson) : []) {
    if (item.type === 'message') {
      for (const part of Array.isArray(item.content) ? item.content.map(asJson) : []) {
        if (part.type !== 'output_text') continue
        if (typeof part.text === 'string') parsed.text += part.text
        for (const note of Array.isArray(part.annotations) ? part.annotations.map(asJson) : [])
          if (note.type === 'url_citation') parsed.citations.push(note)
      }
    } else if (item.type === 'web_search_call') {
      const action = asJson(item.action)
      parsed.searches.push({
        status: item.status,
        ...(action.query !== undefined ? { query: action.query } : {}),
        ...(action.queries !== undefined ? { queries: action.queries } : {}),
      })
    }
  }
  return parsed
}

/** 发一次 `/responses` 请求（非流式），返回文本和 `response_id`、引用来源等元信息。 */
export async function responsesChat(call: ResponsesCall): Promise<SubmitResult> {
  const { ctx, label } = call
  const body = await responsesBody(call)
  const data = await request({
    ctx,
    url: `${call.baseURL}/responses`,
    method: 'POST',
    headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    label,
    messages: call.messages,
    secrets: [call.apiKey],
    retries: 0,
  })
  const filter = asJson(asJson(data.incomplete_details).content_filter)
  if (Object.keys(filter).length)
    throw new ProviderError('content_policy', `${label}拒绝生成此内容`)
  const parsed = parseOutput(data.output)
  if (!parsed.text) throw new ProviderError('unknown', `${label}响应缺少对话内容`)
  ctx.stream?.({ text: parsed.text })
  const usage = asJson(data.usage)
  const meta: Json = {
    response_id: data.id,
    status: data.status,
    ...(parsed.citations.length ? { citations: parsed.citations } : {}),
    ...(parsed.searches.length ? { web_searches: parsed.searches } : {}),
    ...(usage.tool_usage !== undefined ? { tool_usage: usage.tool_usage } : {}),
    ...(asJson(data.incomplete_details).reason !== undefined
      ? { incomplete_reason: asJson(data.incomplete_details).reason }
      : {}),
  }
  return {
    state: 'succeeded',
    outputs: [
      { type: 'text', text: parsed.text },
      { type: 'json', value: meta },
    ],
    usage: {
      ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
    },
  }
}
