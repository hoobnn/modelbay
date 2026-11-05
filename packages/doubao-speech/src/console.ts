/**
 * 火山引擎语音控制面（OpenAPI）的 HMAC-SHA256 签名。
 *
 * 控制面不是用 `X-Api-Key`，而是 IAM 的 AK/SK 签名请求：
 * `open.volcengineapi.com` + `speech_saas_prod` 服务 + `day/region/service/request`
 * 的密钥链。签名覆盖实际发出去的字节（payload 的 SHA-256 进 canonical 请求）。
 *
 * 用 WebCrypto 实现，不引入第三方依赖，也不碰 Node 专属 API。
 */
import { ProviderError } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { asJson, failure, isJson, readText, send, type Json } from './http'

/** 控制面的域名。 */
export const CONSOLE_HOST = 'open.volcengineapi.com'
export const CONSOLE_ENDPOINT = `https://${CONSOLE_HOST}`
/** 控制面的服务名（密钥链的第三段）。 */
export const CONSOLE_SERVICE = 'speech_saas_prod'

/**
 * 官方已公布的 Action → Version 对照。
 *
 * 没有收录的 Action 必须由调用方显式给出 Version，不猜。
 */
export const CONSOLE_VERSIONS: Record<string, string> = {
  ListSpeakers: '2025-05-20',
  ListBigModelTTSTimbres: '2025-05-20',
  ListAPIKeys: '2025-05-20',
  CreateAPIKey: '2025-05-20',
  UpdateAPIKey: '2025-05-20',
  DeleteAPIKey: '2025-05-20',
  ServiceStatus: '2025-05-20',
  PauseService: '2025-05-20',
  ResumeService: '2025-05-20',
  ActivateService: '2025-05-20',
  TerminateService: '2025-05-20',
  FormalizeResourcePacks: '2025-05-20',
  ResourcePacksStatus: '2025-05-20',
  AliasResourcePack: '2025-05-20',
  OrderResourcePacks: '2025-05-20',
  ListMegaTTSTrainStatus: '2025-05-21',
  BatchListMegaTTSTrainStatus: '2025-05-21',
  OrderAccessResourcePacks: '2025-05-21',
  RenewAccessResourcePacks: '2025-05-21',
  QuotaMonitoring: '2025-05-21',
  UsageMonitoring: '2025-05-21',
  TagResources: '2025-05-21',
  UntagResources: '2025-05-21',
  ListTagsForResources: '2025-05-21',
  ListMegaTTSByOrderID: '2023-11-07',
}

const encoder = new TextEncoder()

/** `crypto.subtle` 只接受以 ArrayBuffer 撑起来的视图，这里统一收窄类型。 */
function bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data) as Uint8Array<ArrayBuffer>
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(data))))
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)))
}

/**
 * 按 RFC 3986 转义查询参数值（火山 OpenAPI 签名要求）。
 *
 * 安全字符只有字母、数字与 `_.-~`，其余（含 `/`）都要转义；空格是 `%20` 不是 `+`。
 */
export function quoteValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** 按 key 排序拼出查询串（签名用的规范查询串）。 */
export function buildQuery(parameters: Record<string, unknown>): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${quoteValue(key)}=${quoteValue(String(parameters[key]))}`)
    .join('&')
}

export interface SignedHeaderOptions {
  region?: string
  /** 形如 `20261009T000102Z`；不传就用当前 UTC 时间。 */
  timestamp?: string
  contentType?: string
  method?: string
}

/** 当前 UTC 时间的官方格式（`%Y%m%dT%H%M%SZ`）。 */
export function utcTimestamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/**
 * 生成签名请求头。
 *
 * 签的是实际发出去的字节：payload 变了签名就会变，宿主改 body 后必须重新签名。
 */
export async function signedHeaders(
  payload: Uint8Array,
  query: string,
  accessKey: string,
  secretKey: string,
  options: SignedHeaderOptions = {},
): Promise<Record<string, string>> {
  const region = options.region ?? 'cn-beijing'
  const method = options.method ?? 'POST'
  const contentType = options.contentType ?? 'application/json; charset=UTF-8'
  const timestamp = options.timestamp ?? utcTimestamp()
  const day = timestamp.slice(0, 8)
  const digest = await sha256Hex(payload)
  const canonicalHeaders = `host:${CONSOLE_HOST}\nx-content-sha256:${digest}\nx-date:${timestamp}\n`
  const names = 'host;x-content-sha256;x-date'
  const canonical = `${method}\n/\n${query}\n${canonicalHeaders}\n${names}\n${digest}`
  const scope = `${day}/${region}/${CONSOLE_SERVICE}/request`
  const stringToSign = `HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256Hex(encoder.encode(canonical))}`
  let key = encoder.encode(secretKey)
  for (const value of [day, region, CONSOLE_SERVICE, 'request']) key = await hmac(key, value)
  const signature = toHex(await hmac(key, stringToSign))
  return {
    'Content-Type': contentType,
    Host: CONSOLE_HOST,
    'X-Date': timestamp,
    'X-Content-Sha256': digest,
    Authorization: `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
  }
}

export interface ConsoleActionOptions {
  /** 调用方显式给的 Version；不传就用 `CONSOLE_VERSIONS` 里的官方版本。 */
  version?: string
  region?: string
  method?: 'GET' | 'POST'
  accessKey?: string
  secretKey?: string
}

/**
 * 控制面动作的路由规则：哪些 Action 走 GET、哪些走别的地域。
 *
 * 配额/用量监控的旧版本和
 * `ListApplications` 走 `cn-north-1` 的 GET，其余走 `cn-beijing` 的 POST。
 */
export function consoleRoute(
  action: string,
  version: string,
): { method: 'GET' | 'POST'; region: string } {
  if (version === '2021-08-30' && (action === 'QuotaMonitoring' || action === 'UsageMonitoring'))
    return { method: 'GET', region: 'cn-north-1' }
  if (action === 'ListApplications') return { method: 'GET', region: 'cn-north-1' }
  return { method: 'POST', region: 'cn-beijing' }
}

/**
 * 调用控制面接口。
 *
 * AK/SK 从 `VOLC_ACCESS_KEY_ID` / `VOLC_SECRET_ACCESS_KEY` 取；
 * 没有凭证就直接拒绝，不会退回到 API Key。
 */
export async function consoleAction(
  ctx: AdapterContext,
  action: string,
  parameters: Json,
  options: ConsoleActionOptions = {},
): Promise<Json> {
  if (!action || !/^[A-Za-z0-9]+$/.test(action))
    throw new ProviderError('invalid_input', 'console-management requires an official Action')
  const version = options.version ?? CONSOLE_VERSIONS[action]
  if (!version)
    throw new ProviderError('invalid_input', 'console-management requires an official Version')
  const accessKey = options.accessKey ?? ctx.secret('VOLC_ACCESS_KEY_ID')
  const secretKey = options.secretKey ?? ctx.secret('VOLC_SECRET_ACCESS_KEY')
  if (!accessKey || !secretKey)
    throw new ProviderError(
      'auth',
      'console-management requires VOLC_ACCESS_KEY_ID and VOLC_SECRET_ACCESS_KEY',
    )
  const route = consoleRoute(action, version)
  const method = options.method ?? route.method
  const region = options.region ?? route.region
  const queryParameters: Record<string, unknown> = { Action: action, Version: version }
  const body: Json = { ...parameters }
  if (method === 'GET') Object.assign(queryParameters, parameters)
  const query = buildQuery(queryParameters)
  const payload = method === 'GET' ? new Uint8Array(0) : encoder.encode(JSON.stringify(body))
  const requestHeaders = await signedHeaders(payload, query, accessKey, secretKey, {
    region,
    method,
  })
  const messages = {
    cancelled: 'Volcengine console request cancelled',
    network: 'Volcengine console request failed; submission outcome unknown',
    timeout: 'Volcengine console request timeout',
  }
  const response = await send(
    ctx,
    `${CONSOLE_ENDPOINT}/?${query}`,
    {
      method,
      headers: requestHeaders,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    },
    messages,
  )
  const raw = await readText(ctx, response, method, messages)
  let data: Json = {}
  try {
    const parsed: unknown = JSON.parse(raw)
    data = isJson(parsed) ? parsed : {}
  } catch {
    if (!response.ok) throw failure(response.status, response.status, raw, ctx)
    throw new ProviderError('unknown', 'Volcengine console returned invalid JSON', {
      retryable: false,
      cause: { status: response.status },
    })
  }
  const status = response.headers.get('X-Api-Status-Code')
  const code = data.code ?? data.Code ?? status ?? response.status
  const topError = asJson(asJson(data.ResponseMetadata).Error)
  const statusText = data.status ?? data.Status
  if (
    !response.ok ||
    Object.keys(topError).length ||
    statusText === 'error' ||
    statusText === 'failed'
  )
    throw failure(
      response.status,
      code,
      topError.Message ?? topError.Code ?? data.message ?? data.Message ?? raw,
      ctx,
    )
  return data
}
