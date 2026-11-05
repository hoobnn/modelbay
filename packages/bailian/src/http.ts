/**
 * Bailian / DashScope HTTP transport: fetch, retry rules, redaction and error mapping.
 *
 * Only `ctx.fetch` and `ctx.secret` are used; the raw upstream error code/message is
 * preserved in `ProviderError.cause` (with credentials scrubbed).
 */
import { ProviderError, redact, type ProviderErrorCode } from '@modelbay/core'
import type { AdapterContext, AssetRef, LoadedFile } from '@modelbay/core'
import { redact as maskSecrets } from '@modelbay/shared'

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

/** 宿主的百炼设置（与 plein bailian provider 的 settings 同名同义）；没有这层配置时为空对象。 */
export function bailianSettings(ctx: Pick<AdapterContext, 'settings'>): Json {
  return asJson(ctx.settings)
}

const REGION_HOSTS: Record<string, string> = {
  'cn-beijing': DEFAULT_BASE_URL,
  'ap-southeast-1': 'https://dashscope-intl.aliyuncs.com',
  'us-east-1': 'https://dashscope-us.aliyuncs.com',
}

/**
 * 请求域名。优先级：
 * 1. MCP / CLI 的 `BAILIAN_BASE_URL` / `DASHSCOPE_BASE_URL`（整体换域名）；
 * 2. 宿主 `settings.workspaceId` + `settings.region`：`https://{workspaceId}.{region}.maas.aliyuncs.com`；
 * 3. 宿主 `settings.region` 对应的 DashScope 兼容端点；
 * 4. 北京地域默认域名。
 */
export function baseUrl(ctx: AdapterContext): string {
  const override =
    ctx.secret('BAILIAN_BASE_URL')?.trim() || ctx.secret('DASHSCOPE_BASE_URL')?.trim()
  // 只认完整的 http(s) 地址；其余（宿主把任意密钥名都映射成同一个值时）按未设置处理
  if (override && /^https?:\/\/\S+$/i.test(override)) return override
  const settings = bailianSettings(ctx)
  const region =
    typeof settings.region === 'string' && settings.region ? settings.region : 'cn-beijing'
  const workspaceId = typeof settings.workspaceId === 'string' ? settings.workspaceId.trim() : ''
  if (workspaceId) {
    if (!/^[a-zA-Z0-9-]+$/.test(workspaceId) || !/^[a-z0-9-]+$/.test(region))
      throw new ProviderError('invalid_input', '业务空间 ID 或地域格式无效')
    return `https://${workspaceId}.${region}.maas.aliyuncs.com`
  }
  return REGION_HOSTS[region] ?? DEFAULT_BASE_URL
}

/** 任务轮询间隔：宿主设置优先，其次 MCP 的环境变量，默认 10 秒。 */
export function pollAfter(ctx: AdapterContext): number {
  const fromSettings = bailianSettings(ctx).pollIntervalMs
  const value =
    typeof fromSettings === 'number'
      ? fromSettings
      : Number(ctx.secret('BAILIAN_POLL_INTERVAL_MS') ?? ctx.secret('DASHSCOPE_POLL_INTERVAL_MS'))
  return Number.isFinite(value) && value >= 1000 ? value : 10_000
}

/** 读素材：优先宿主的 `files.read`（带媒体元数据），回退到 `assets.load`。 */
export async function readAsset(ctx: AdapterContext, ref: AssetRef): Promise<LoadedFile> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets) throw new ProviderError('invalid_input', '读取参考素材需要宿主提供素材来源')
  const loaded = await ctx.assets.load(ref.assetId)
  return { data: loaded.data, mime: (loaded.mime || ref.mime || '').toLowerCase() }
}

export function apiKey(ctx: AdapterContext): string {
  for (const name of API_KEY_NAMES) {
    const value = ctx.secret(name)?.trim()
    if (value) return value
  }
  throw new ProviderError('auth', '请配置 DASHSCOPE_API_KEY')
}

export function requestMessages(method: Method): TransportMessages {
  const failed =
    method === 'GET' ? '百炼请求中断或网络不可用' : '百炼提交状态未知；请先恢复查询，勿重新生成'
  return { cancelled: failed, network: failed, timeout: failed }
}

/** Map the upstream `{ code, message }` to a normalized error, keeping the raw detail in `cause`. */
export function remoteError(status: number, value: unknown, ctx: AdapterContext): ProviderError {
  const data = asJson(value)
  const error = asJson(data.error)
  const code = String(error.code ?? data.code ?? '').toLowerCase()
  const raw = String(error.message ?? data.message ?? `百炼 HTTP ${status}`)
  const message = maskSecrets(raw, apiKeySecrets(ctx), { mask: '[REDACTED]', tokens: true })
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
  return new ProviderError(normalized, message, {
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

/** Send a request and return the raw response; HTTP errors are mapped to a ProviderError. */
export async function requestResponse(
  ctx: AdapterContext,
  path: string,
  body?: Json,
  opts: RequestOptions = {},
): Promise<Response> {
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
  return res
}

/** Send a JSON request and return the parsed business object; throws a mapped ProviderError. */
export async function requestJson(
  ctx: AdapterContext,
  path: string,
  body?: Json,
  opts: RequestOptions = {},
): Promise<Json> {
  const method: Method = opts.method ?? (body === undefined ? 'GET' : 'POST')
  const res = await requestResponse(ctx, path, body, opts)
  const value = await readJson(ctx, res, method, requestMessages(method))
  if (value === null)
    throw new ProviderError('unknown', '百炼返回无效 JSON；请勿自动重新提交生成任务', {
      retryable: false,
    })
  const data = asJson(value)
  if (Object.keys(data).length === 0) throw new ProviderError('unknown', '百炼返回空响应')
  if (data.code || data.error)
    throw withRetry(remoteError(res.status, data, ctx), method, res.status)
  return data
}
