/**
 * HTTP transport shared by the Ark channels. Uses only `ctx.fetch` (host injected)
 * so recordings can replace it; keys come from `ctx.secret(name)` and never reach
 * logs, fixtures or error messages. Each platform package keeps its own copy so
 * there is no cross-adapter dependency.
 */
import { ProviderError, type AdapterContext, type ProviderErrorCode } from '@modelbay/core'

export type Json = Record<string, unknown>
export type Method = 'GET' | 'POST' | 'DELETE'

/** Narrow `unknown` to a plain object. */
export function isJson(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Non-object values are treated as an empty object. */
export function asJson(value: unknown): Json {
  return isJson(value) ? value : {}
}

/**
 * Replace secrets in error text with `[redacted]`, longest first so a
 * short key that is a substring of a longer one cannot survive. Also strips Bearer / sk- tokens.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  const mask = '[redacted]'
  const list = secrets
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.length - a.length)
  for (const secret of list) text = text.split(secret).join(mask)
  return text.replace(/Bearer\s+\S+/gi, `Bearer ${mask}`).replace(/sk-[a-zA-Z0-9_-]+/g, mask)
}

export interface TransportMessages {
  cancelled: string
  network: string
  timeout?: string
}

function isTimeout(value: unknown): boolean {
  return value instanceof Error && value.name === 'TimeoutError'
}

/** Retryable errors: rate limiting, unavailability and timeouts, GET only. */
export function retryableFor(method: Method, code: ProviderErrorCode): boolean {
  return method === 'GET' && (code === 'rate_limit' || code === 'unavailable' || code === 'timeout')
}

/**
 * A gateway timeout / 5xx on a POST cannot prove the platform did not accept the
 * job, so it is marked as `outcome: 'unknown'` and never auto-retried.
 */
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

/** Classify a fetch / body-read failure by method, abort signal and cause. */
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

export interface SendInit {
  method: Method
  headers?: Record<string, string>
  body?: string
}

/** Single fetch call; only transport failures are handled here. */
export async function send(
  ctx: Pick<AdapterContext, 'fetch' | 'signal'>,
  url: string,
  init: SendInit,
  messages: TransportMessages,
): Promise<Response> {
  // 还没发出请求时可以确定没有提交；发出后再取消则无法判断平台是否已受理
  if (ctx.signal.aborted)
    throw new ProviderError(
      isTimeout(ctx.signal.reason) ? 'timeout' : 'cancelled',
      messages.cancelled,
      { retryable: false },
    )
  try {
    return await ctx.fetch(url, {
      method: init.method,
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: ctx.signal,
    })
  } catch (cause) {
    throw transportError(ctx, init.method, cause, messages)
  }
}

/** Read a response body, preserving abort / timeout classification. */
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

/** A non-JSON body is returned as `null`; HTTP / business errors are handled by the caller. */
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

export type ErrorClassifier = (
  status: number,
  code: string,
  signal: string,
) => ProviderErrorCode | undefined

/** Default HTTP-status / keyword mapping, shared by all channels. */
export function defaultClassify(status: number, signal: string): ProviderErrorCode {
  if (/quota|balance|insufficient|arrears/.test(signal) || status === 402) return 'quota'
  if (/sensitive|content.?policy|content.?filter|risk|moderation/.test(signal))
    return 'content_policy'
  if (
    status === 401 ||
    status === 403 ||
    /authentication|unauthorized|apikey|api_key|modelnotopen|accessdenied/.test(signal)
  )
    return 'auth'
  if (status === 429 || /ratelimit|rate.?limit|bursttoofast/.test(signal)) return 'rate_limit'
  if (status === 408 || status === 504 || /timeout|expired/.test(signal)) return 'timeout'
  if (/cancelled|canceled/.test(signal)) return 'cancelled'
  if (status >= 500 || /serveroverloaded|serviceunavailable/.test(signal)) return 'unavailable'
  if (status >= 400 || /invalidparameter|invalidrequest/.test(signal)) return 'invalid_input'
  return 'unknown'
}

export interface HttpErrorOptions {
  label: string
  status: number
  body: unknown
  method: Method
  secrets: Array<string | undefined>
  classify?: ErrorClassifier
}

/**
 * Map an HTTP failure to `ProviderError`. The upstream code / message (redacted)
 * is kept in `cause` so the host can show it without losing information.
 */
export function httpError(opts: HttpErrorOptions): ProviderError {
  const { label, status, body, method, secrets, classify } = opts
  const root = asJson(body)
  const error = asJson(root.error ?? root)
  const rawCode = String(error.code ?? error.type ?? root.code ?? '')
  const rawMessage =
    typeof error.message === 'string'
      ? error.message
      : typeof root.message === 'string'
        ? root.message
        : `${label} 请求失败（HTTP ${status}）`
  const message = redactSecrets(rawMessage, secrets)
  const signal = `${rawCode} ${message}`.toLowerCase()
  const code = classify?.(status, rawCode.toLowerCase(), signal) ?? defaultClassify(status, signal)
  const wrapped = new ProviderError(code, message, {
    cause: { status, code: rawCode, message: redactSecrets(rawMessage, secrets) },
  })
  return withRetry(wrapped, method, status)
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new ProviderError('cancelled', '请求已取消'))
      },
      { once: true },
    )
  })
}

export interface RequestOptions {
  ctx: AdapterContext
  url: string
  method: Method
  headers: Record<string, string>
  body?: string
  label: string
  messages: TransportMessages
  secrets: Array<string | undefined>
  classify?: ErrorClassifier
  /** GET 默认重试 2 次；POST 默认 0 次（提交不可重试）。 */
  retries?: number
  /** 重试间隔，默认 0；宿主轮询本身带退避，这里不额外等待。 */
  retryDelayMs?: number
  /** 业务失败状态（如视频任务的 failed）不在此处抛错，交给轮询逻辑处理。 */
  toleratedStatuses?: string[]
}

/**
 * Send a request, parse JSON, classify failures and retry retryable GETs.
 * All network access goes through `ctx.fetch`.
 */
export async function request(opts: RequestOptions): Promise<Json> {
  const { ctx, url, method, headers, body, label, messages, secrets, classify } = opts
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0)
  const retryDelayMs = opts.retryDelayMs ?? 0
  let attempt = 0
  for (;;) {
    const response = await send(
      ctx,
      url,
      { method, headers, ...(body === undefined ? {} : { body }) },
      messages,
    )
    const value = await readJson(ctx, response, method, messages)
    const root = asJson(value)
    const hasError = root.error !== undefined && root.error !== null
    const tolerated = opts.toleratedStatuses?.includes(String(root.status)) ?? false
    if (response.ok && (!hasError || tolerated)) {
      if (value === null)
        throw new ProviderError('unknown', `${label} 返回无效 JSON；不会自动重新提交`)
      return root
    }
    const error = httpError({
      label,
      status: response.status,
      body: value,
      method,
      secrets,
      classify,
    })
    if (error.retryable && attempt < retries) {
      attempt += 1
      await pause(retryDelayMs, ctx.signal)
      continue
    }
    throw error
  }
}
