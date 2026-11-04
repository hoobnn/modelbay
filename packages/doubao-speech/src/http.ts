/**
 * Doubao Speech HTTP transport: chunked JSON streams, signed headers, error mapping.
 * Only `ctx.fetch` / `ctx.secret` are used; raw upstream details go into `cause`.
 */
import { ProviderError, redact, type ProviderErrorCode } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'

export const HOST = 'https://openspeech.bytedance.com'

/**
 * Canonical secret names (used by the `modelbay` entry / CLI): `DOUBAO_APP_ID` +
 * `DOUBAO_ACCESS_TOKEN` for the legacy app-key pair, or `DOUBAO_API_KEY` for the
 * modern `X-Api-Key`. The `VOLC_SPEECH_*` upstream names are accepted as aliases so
 * existing hosts keep working.
 */
export const API_KEY_NAMES = ['DOUBAO_API_KEY', 'VOLC_SPEECH_API_KEY'] as const
export const APP_ID_NAMES = ['DOUBAO_APP_ID', 'VOLC_SPEECH_APP_ID'] as const
export const ACCESS_TOKEN_NAMES = [
  'DOUBAO_ACCESS_TOKEN',
  'VOLC_SPEECH_ACCESS_TOKEN',
  'VOLC_SPEECH_ACCESS_KEY',
] as const
/** Every credential name, used for error/log redaction. */
export const SECRET_NAMES = [...API_KEY_NAMES, ...APP_ID_NAMES, ...ACCESS_TOKEN_NAMES]

/** Resolve the first configured value for a group of alias names. */
export function firstSecret(ctx: AdapterContext, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = ctx.secret(name)
    if (value) return value
  }
  return undefined
}

/** True when at least one complete credential set is available. */
export function hasCredentials(ctx: AdapterContext): boolean {
  return (
    Boolean(firstSecret(ctx, API_KEY_NAMES)) ||
    Boolean(firstSecret(ctx, APP_ID_NAMES) && firstSecret(ctx, ACCESS_TOKEN_NAMES))
  )
}

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

/** Remove known secrets then apply the generic core redactor. */
export function scrub(text: string, ctx: AdapterContext): string {
  let out = text
  const known = SECRET_NAMES.map((name) => ctx.secret(name)).filter((value): value is string =>
    Boolean(value),
  )
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
  init: { method: Method; headers?: Record<string, string>; body?: string },
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

/** Build the request headers; supports the modern API key and the legacy APP ID pair. */
export function headers(ctx: AdapterContext, resource?: string): Record<string, string> {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': crypto.randomUUID(),
  }
  const key = firstSecret(ctx, API_KEY_NAMES)
  if (key) result['X-Api-Key'] = key
  else {
    const app = firstSecret(ctx, APP_ID_NAMES)
    const access = firstSecret(ctx, ACCESS_TOKEN_NAMES)
    if (!app || !access)
      throw new ProviderError(
        'auth',
        'Missing DOUBAO_API_KEY or DOUBAO_APP_ID + DOUBAO_ACCESS_TOKEN',
      )
    result['X-Api-App-Key'] = app
    result['X-Api-Access-Key'] = access
  }
  if (resource) result['X-Api-Resource-Id'] = resource
  return result
}

/** Normalize a Doubao status code / message into a ProviderError, keeping raw details. */
export function failure(
  status: number,
  code: unknown,
  message: unknown,
  ctx: AdapterContext,
): ProviderError {
  const detail = scrub(typeof message === 'string' ? message : 'request failed', ctx).slice(0, 500)
  let normalized: ProviderErrorCode = 'unknown'
  if (/resource id is mismatched with speaker related resource/i.test(detail)) {
    return new ProviderError('invalid_input', `Doubao ${code ?? status}: voice/resource mismatch`, {
      retryable: false,
      cause: { status, code, detail },
    })
  }
  if (
    status === 401 ||
    status === 403 ||
    /\bunauthori[sz]ed\b|\binvalid[ _-]?(?:token|api[ _-]?key|credential)|鉴权|权限/i.test(detail)
  )
    normalized = 'auth'
  else if (status === 402 || /\bquota\b|\binsufficient balance\b|欠费|余额|额度/i.test(detail))
    normalized = 'quota'
  else if (
    status === 429 ||
    /\brate[ _-]?limit|\btoo many requests\b|\bconcurrency\b|limit exceeded|限流|并发/i.test(detail)
  )
    normalized = 'rate_limit'
  else if (/content.?policy|sensitive|违规|敏感/i.test(detail)) normalized = 'content_policy'
  else if (status === 408 || status === 504) normalized = 'timeout'
  else if (status >= 500 || String(code).startsWith('550')) normalized = 'unavailable'
  else if (status === 400 || String(code).startsWith('450')) normalized = 'invalid_input'
  return new ProviderError(normalized, `Doubao ${scrub(String(code ?? status), ctx)}: ${detail}`, {
    retryable: false,
    cause: { status, code, detail },
    ...(status === 408 || status >= 500 ? { outcome: 'unknown' as const } : {}),
  })
}

/** A truncated chunked stream is an ambiguous submission outcome. */
export function incomplete(message: string): ProviderError {
  return new ProviderError('unavailable', message, { retryable: false, outcome: 'unknown' })
}

export interface PostOptions {
  resource?: string
  asr?: boolean
  extraHeaders?: Record<string, string>
  idempotencyKey?: string
}

/** POST a JSON body and return the raw (possibly chunked) response text. */
export async function postText(
  ctx: AdapterContext,
  path: string,
  body: Json,
  opts: PostOptions = {},
): Promise<string> {
  const requestHeaders = { ...headers(ctx, opts.resource), ...opts.extraHeaders }
  if (opts.asr) requestHeaders['X-Api-Sequence'] = '-1'
  if (opts.idempotencyKey) requestHeaders['X-Api-Request-Id'] = opts.idempotencyKey
  const messages = {
    cancelled: 'Doubao request cancelled',
    network: 'Doubao network failure, submission outcome unknown',
    timeout: 'Doubao request timeout, submission outcome unknown',
  }
  let response: Response
  try {
    response = await send(
      ctx,
      `${HOST}${path}`,
      { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) },
      messages,
    )
  } catch (cause) {
    if (cause instanceof ProviderError) throw withRetry(cause, 'POST')
    throw cause
  }
  const raw = await readText(ctx, response, 'POST', messages)
  const status = response.headers.get('X-Api-Status-Code')
  if (!response.ok || (status && status !== '20000000' && !(opts.asr && status === '20000003'))) {
    let detail: Json = {}
    try {
      const parsed = asJson(JSON.parse(raw))
      detail = isJson(parsed.header) ? parsed.header : parsed
    } catch {
      // Response headers may still carry the error when the body is not JSON.
    }
    throw failure(
      response.status,
      detail.code ?? status,
      detail.message ?? response.headers.get('X-Api-Message'),
      ctx,
    )
  }
  return raw
}

/** HTTP chunked responses may contain newline-delimited OR directly adjacent JSON objects. */
export function events(raw: string): Json[] {
  const result: Json[] = []
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!
    if (start < 0) {
      if (/\s/.test(c)) continue
      if (c !== '{') throw incomplete('Doubao returned an invalid audio stream')
      start = i
    }
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === '{' || c === '[') depth += 1
    else if (c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          result.push(asJson(JSON.parse(raw.slice(start, i + 1))))
        } catch {
          throw incomplete('Doubao returned an invalid audio stream')
        }
        start = -1
      }
    }
  }
  if (start >= 0 || result.length === 0) throw incomplete('Doubao audio stream is incomplete')
  return result
}

/** POST a JSON body for a single-object (management) response. */
export async function postJson(
  ctx: AdapterContext,
  path: string,
  body: Json,
  opts: PostOptions = {},
): Promise<Json> {
  const raw = await postText(ctx, path, body, opts)
  try {
    return asJson(JSON.parse(raw))
  } catch {
    throw incomplete('Doubao returned invalid JSON')
  }
}
