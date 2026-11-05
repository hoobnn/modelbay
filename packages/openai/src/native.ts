/** Responses operations that need native items, built-in tools or background status. */
import { ProviderError, type AdapterContext } from '@modelbay/core'
import { asJson, isJson, request, type Json, type TransportMessages } from './http'
import { classifyOpenAI, OPENAI_BASE } from './chat'

export const nativeOperationSchemas: Record<string, Record<string, unknown>> = {
  'raw-request': {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Responses path relative to /v1, e.g. /responses or /responses/resp_123',
      },
      method: { type: 'string', enum: ['GET', 'POST', 'DELETE'], default: 'POST' },
      body: { type: 'object' },
      query: { type: 'object' },
    },
  },
}

/** Return the unmodified JSON response; the host retains IDs, items and statuses. */
export async function responsesRequest(
  params: Json,
  ctx: AdapterContext,
  key: string,
  messages: TransportMessages,
): Promise<Json> {
  const path = params.path
  const method = params.method ?? 'POST'
  // Enumerated relative routes keep credentials on the official origin.
  const collection = path === '/responses' || path === '/responses/compact'
  const resource =
    typeof path === 'string' &&
    /^\/responses\/[A-Za-z0-9_-]+(?:\/(?:cancel|input_items))?$/.test(path)
  if (!collection && !resource)
    throw new ProviderError(
      'invalid_input',
      'raw-request 只支持 /responses、/responses/compact 和响应资源路径',
    )
  const allowed =
    path === '/responses' || path === '/responses/compact' || String(path).endsWith('/cancel')
      ? ['POST']
      : String(path).endsWith('/input_items')
        ? ['GET']
        : ['GET', 'DELETE']
  if (typeof method !== 'string' || !allowed.includes(method))
    throw new ProviderError('invalid_input', 'Responses 路径不支持该 HTTP 方法')
  if (params.body !== undefined && !isJson(params.body))
    throw new ProviderError('invalid_input', 'body 必须是 JSON 对象')
  const body = asJson(params.body)
  if (body.stream === true)
    throw new ProviderError('invalid_input', 'raw-request 返回 JSON；流式文本请使用 text.chat')
  if (method !== 'POST' && params.body !== undefined)
    throw new ProviderError('invalid_input', 'GET / DELETE 不接受 body')
  if (params.query !== undefined && !isJson(params.query))
    throw new ProviderError('invalid_input', 'query 必须是对象')
  if (asJson(params.query).stream !== undefined && asJson(params.query).stream !== false)
    throw new ProviderError('invalid_input', 'raw-request 不支持流式 query')
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(asJson(params.query))) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (!['string', 'number', 'boolean'].includes(typeof item))
        throw new ProviderError('invalid_input', 'query 值须为字符串、数字、布尔或它们的数组')
      query.append(name, String(item))
    }
  }
  return request({
    ctx,
    url: `${OPENAI_BASE}${path}${query.size ? `?${query}` : ''}`,
    method: method as 'GET' | 'POST' | 'DELETE',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    label: 'OpenAI',
    messages,
    secrets: [key],
    classify: classifyOpenAI,
    // Native callers inspect failed response resources themselves.
    toleratedStatuses: ['failed', 'cancelled', 'incomplete'],
  })
}
