/**
 * Bailian / DashScope HTTP transport: fetch, retry rules, redaction and error mapping.
 *
 * Only `ctx.fetch` and `ctx.secret` are used; the raw upstream error code/message is
 * preserved in `ProviderError.cause` (with credentials scrubbed).
 */
import { ProviderError, redact, type ProviderErrorCode } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'

export type Json = Record<string, unknown>
export type Method = 'GET' | 'POST' | 'DELETE'

export function isJson(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Treat non-objects as an empty object. */
export function asJson(value: unknown): Json {
  return isJson(value) ? value : {}
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Remove known secrets first (longest first), then the generic core redactor. */
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

/**
 * POST submissions are never retryable (the platform may already have accepted and
 * billed them); GET queries may be retried on rate-limit / unavailable / timeout.
 */
export function retryableFor(method: Method, code: ProviderErrorCode): boolean {
  return method === 'GET' && (code === 'rate_limit' || code === 'unavailable' || code === 'timeout')
}

/** Preserve the "submission outcome unknown" flag for POST gateway failures. */
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

/** Classify transport-level failures (abort / timeout / network). */
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

/** Send a request; HTTP status is left to the platform-specific parser. */
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

/** Reading the body can still fail after headers arrived. */
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

/** A fully-read non-JSON body is treated as null; HTTP/business errors are parsed by the caller. */
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

export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com'

/**
 * Canonical secret name is `BAILIAN_API_KEY` (used by the `modelbay` entry / CLI).
 * `DASHSCOPE_API_KEY` is accepted as an alias so hosts that already use the upstream
 * name keep working without any change.
 */
export const API_KEY_NAMES = ['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY'] as const

/** All configured API key values, used for error/log redaction. */
export function apiKeySecrets(ctx: AdapterContext): Array<string | undefined> {
  return API_KEY_NAMES.map((name) => ctx.secret(name))
}

/** Host may override the endpoint through `BAILIAN_BASE_URL` / `DASHSCOPE_BASE_URL`. */
export function baseUrl(ctx: AdapterContext): string {
  return (
    ctx.secret('BAILIAN_BASE_URL')?.trim() ||
    ctx.secret('DASHSCOPE_BASE_URL')?.trim() ||
    DEFAULT_BASE_URL
  )
}

export function apiKey(ctx: AdapterContext): string {
  for (const name of API_KEY_NAMES) {
    const value = ctx.secret(name)?.trim()
    if (value) return value
  }
  throw new ProviderError('auth', `Missing ${API_KEY_NAMES[0]}`)
}

export function requestMessages(method: Method): TransportMessages {
  const failed =
    method === 'GET'
      ? 'Bailian request interrupted or network unavailable'
      : 'Bailian submission outcome unknown; query the task before retrying'
  return { cancelled: failed, network: failed, timeout: failed }
}

/** Map the upstream `{ code, message }` to a normalized error, keeping the raw detail in `cause`. */
export function remoteError(status: number, value: unknown, ctx: AdapterContext): ProviderError {
  const data = asJson(value)
  const error = asJson(data.error)
  const code = String(error.code ?? data.code ?? '').toLowerCase()
  const raw = String(error.message ?? data.message ?? `Bailian HTTP ${status}`)
  const message = scrub(raw, apiKeySecrets(ctx))
  const normalized: ProviderErrorCode =
    status === 401 || status === 403 || /apikey|accessdenied|unauthorized/.test(code)
      ? 'auth'
      : /quota|arrear|balance|insufficient/.test(code)
        ? 'quota'
        : /inspection|inappropriate|safety|contentfilter/.test(code)
          ? 'content_policy'
          : status === 429 || /throttl|ratelimit/.test(code)
            ? 'rate_limit'
            : status === 408 || status === 504
              ? 'timeout'
              : status >= 500
                ? 'unavailable'
                : status >= 400 || /invalid|unsupported/.test(code)
                  ? 'invalid_input'
                  : 'unknown'
  return new ProviderError(normalized, `Bailian: ${message}`, {
    cause: { status, code: String(error.code ?? data.code ?? ''), message },
  })
}

export interface RequestOptions {
  method?: Method
  /** `X-DashScope-Async: enable` for asynchronous tasks. */
  asyncTask?: boolean
  /** `X-DashScope-OssResourceResolve: enable` for uploaded OSS assets. */
  oss?: boolean
  extraHeaders?: Record<string, string>
}

/** Send a JSON request and return the parsed business object; throws a mapped ProviderError. */
export async function requestJson(
  ctx: AdapterContext,
  path: string,
  body?: Json,
  opts: RequestOptions = {},
): Promise<Json> {
  const method: Method = opts.method ?? (body === undefined ? 'GET' : 'POST')
  const messages = requestMessages(method)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey(ctx)}`,
    'Content-Type': 'application/json',
    ...opts.extraHeaders,
    ...(opts.asyncTask ? { 'X-DashScope-Async': 'enable' } : {}),
    ...(opts.oss ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}),
  }
  const res = await send(
    ctx,
    baseUrl(ctx) + path,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    messages,
  )
  if (!res.ok) {
    const data = await readJson(ctx, res, method, messages)
    throw withRetry(remoteError(res.status, data, ctx), method, res.status)
  }
  const value = await readJson(ctx, res, method, messages)
  if (value === null)
    throw new ProviderError('unknown', 'Bailian returned invalid JSON', { retryable: false })
  const data = asJson(value)
  if (Object.keys(data).length === 0)
    throw new ProviderError('unknown', 'Bailian returned an empty response')
  if (data.code || data.error)
    throw withRetry(remoteError(res.status, data, ctx), method, res.status)
  return data
}
