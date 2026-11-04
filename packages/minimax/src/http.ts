/**
 * MiniMax HTTP transport: fetch, retry rules, redaction and `base_resp` / `error` mapping.
 * Only `ctx.fetch` and `ctx.secret` are used; raw upstream details go into `cause`.
 */
import { ProviderError, redact, type ProviderErrorCode } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'

export type Json = Record<string, unknown>
export type Method = 'GET' | 'POST' | 'DELETE'

export function isJson(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function asJson(value: unknown): Json {
  return isJson(value) ? value : {}
}
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function scrub(text: string, secrets: Array<string | undefined>): string {
  let out = text
  const known = secrets.filter((value): value is string => Boolean(value))
  known.sort((a, b) => b.length - a.length)
  for (const secret of known) out = out.split(secret).join('<redacted>')
  return redact(out)
}

export interface TransportMessages {
  cancelled: string
  network: string
  timeout?: string
}

export function retryableFor(method: Method, code: ProviderErrorCode): boolean {
  return method === 'GET' && (code === 'rate_limit' || code === 'unavailable' || code === 'timeout')
}

export function withRetry(error: ProviderError, method: Method, status?: number): ProviderError {
  const unknown =
    method === 'POST' &&
    status !== undefined &&
    (status === 408 || status >= 500) &&
    ['unknown', 'timeout', 'unavailable'].includes(error.code)
  return new ProviderError(error.code, error.message, {
    retryable: retryableFor(method, error.code),
    cause: error.cause,
    ...(error.outcome || unknown ? { outcome: error.outcome ?? 'unknown' } : {}),
  })
}

function isTimeout(value: unknown): boolean {
  return value instanceof Error && value.name === 'TimeoutError'
}

export function transportError(
  ctx: Pick<AdapterContext, 'signal'>,
  method: Method,
  cause: unknown,
  messages: TransportMessages,
): ProviderError {
  if (messages.timeout && (isTimeout(cause) || isTimeout(ctx.signal.reason)))
    return new ProviderError('timeout', messages.timeout, {
      retryable: !ctx.signal.aborted && method === 'GET',
      cause,
      ...(method === 'POST' ? { outcome: 'unknown' as const } : {}),
    })
  if (ctx.signal.aborted)
    return new ProviderError('cancelled', messages.cancelled, {
      cause,
      ...(method === 'POST' ? { outcome: 'unknown' as const } : {}),
    })
  return new ProviderError('unavailable', messages.network, {
    retryable: method === 'GET',
    cause,
    ...(method === 'POST' ? { outcome: 'unknown' as const } : {}),
  })
}

export async function send(
  ctx: Pick<AdapterContext, 'fetch' | 'signal'>,
  url: string,
  init: { method: Method; headers?: Record<string, string>; body?: string | FormData },
  messages: TransportMessages,
): Promise<Response> {
  if (ctx.signal.aborted)
    throw new ProviderError(
      isTimeout(ctx.signal.reason) ? 'timeout' : 'cancelled',
      messages.cancelled,
      {
        retryable: false,
      },
    )
  try {
    return await ctx.fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: ctx.signal,
    })
  } catch (cause) {
    throw transportError(ctx, init.method, cause, messages)
  }
}

export async function readText(
  ctx: Pick<AdapterContext, 'signal'>,
  response: Response,
  method: Method,
  messages: TransportMessages,
): Promise<string> {
  try {
    return await response.text()
  } catch (cause) {
    throw transportError(ctx, method, cause, messages)
  }
}

export async function readJson(
  ctx: Pick<AdapterContext, 'signal'>,
  response: Response,
  method: Method,
  messages: TransportMessages,
): Promise<unknown> {
  const text = await readText(ctx, response, method, messages)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const CN_BASE_URL = 'https://api.minimax.cn'
export const GLOBAL_BASE_URL = 'https://api.minimax.io'

export function baseUrl(ctx: AdapterContext): string {
  const override = ctx.secret('MINIMAX_BASE_URL')?.trim()
  if (override) return override
  return ctx.secret('MINIMAX_REGION') === 'global' ? GLOBAL_BASE_URL : CN_BASE_URL
}

export function apiKey(ctx: AdapterContext): string {
  const value = ctx.secret('MINIMAX_API_KEY')?.trim()
  if (!value) throw new ProviderError('auth', 'Missing MINIMAX_API_KEY')
  return value
}

/** Map MiniMax numeric/string codes to core's normalized error codes. */
export function errorCode(code: number | string): ProviderErrorCode {
  if (Number(code) === 410) return 'unavailable'
  if ([401, 403, 1004, 2038, 2049].includes(Number(code)) || /auth|permission/i.test(String(code)))
    return 'auth'
  if ([402, 1008].includes(Number(code)) || /balance|quota/i.test(String(code))) return 'quota'
  if ([429, 1002].includes(Number(code)) || /rate_limit/i.test(String(code))) return 'rate_limit'
  if ([1026, 1027, 1043].includes(Number(code)) || /sensitive|content_policy/i.test(String(code)))
    return 'content_policy'
  if ([408, 504, 1001].includes(Number(code))) return 'timeout'
  if ((Number(code) >= 500 && Number(code) < 600) || [1000, 1013].includes(Number(code)))
    return 'unavailable'
  if ([400, 422, 2013].includes(Number(code)) || /bad_request|invalid/i.test(String(code)))
    return 'invalid_input'
  return 'unknown'
}

export function requestMessages(method: Method): TransportMessages {
  const failed =
    method === 'GET'
      ? 'MiniMax request interrupted or network unavailable'
      : 'MiniMax submission outcome unknown; do not auto-retry'
  return { cancelled: failed, network: failed, timeout: failed }
}

export interface RequestOptions {
  method?: Method
  /** Raw form upload: Content-Type is left to fetch so it can add the boundary. */
  form?: boolean
  extraHeaders?: Record<string, string>
  /** Query string appended to the path (list endpoints). */
  query?: Record<string, string | number | undefined>
}

/** Send a JSON request (or a FormData upload) and return the parsed business object. */
export async function requestJson(
  ctx: AdapterContext,
  path: string,
  body?: Json | FormData,
  opts: RequestOptions = {},
): Promise<Json> {
  const method: Method = opts.method ?? (body === undefined ? 'GET' : 'POST')
  const messages = requestMessages(method)
  const isForm = body instanceof FormData
  const payload = isForm ? body : body === undefined ? undefined : JSON.stringify(body)
  const queryEntries = opts.query
    ? Object.entries(opts.query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)])
    : []
  const query = queryEntries.length ? `?${new URLSearchParams(queryEntries).toString()}` : ''
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey(ctx)}`,
    ...(isForm || opts.form ? {} : { 'Content-Type': 'application/json' }),
    ...opts.extraHeaders,
  }
  const res = await send(
    ctx,
    `${baseUrl(ctx)}${path}${query}`,
    { method, headers, ...(payload === undefined ? {} : { body: payload }) },
    messages,
  )
  const parsed = await readJson(ctx, res, method, messages)
  if (parsed === null || !isJson(parsed)) {
    const code = res.ok ? 'unknown' : errorCode(res.status)
    throw withRetry(
      new ProviderError(code, `MiniMax returned an invalid response (HTTP ${res.status})`),
      method,
      res.status,
    )
  }
  const data = parsed
  const baseResp = asJson(data.base_resp)
  const statusCode = Number(baseResp.status_code ?? 0)
  const businessError = asJson(data.error)
  if (!res.ok || data.error !== undefined || statusCode !== 0) {
    const rawCode: string | number =
      typeof businessError.type === 'string' && businessError.type
        ? businessError.type
        : statusCode || res.status
    const message = scrub(
      String(businessError.message ?? baseResp.status_msg ?? `HTTP ${res.status}`),
      [ctx.secret('MINIMAX_API_KEY')],
    )
    const normalized = errorCode(rawCode) === 'unknown' ? errorCode(res.status) : errorCode(rawCode)
    throw withRetry(
      new ProviderError(normalized, `MiniMax: ${message}`, {
        cause: { status: res.status, code: rawCode, message },
      }),
      method,
      res.status,
    )
  }
  return data
}
