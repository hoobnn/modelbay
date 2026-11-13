import { ProviderError, type AdapterContext } from '@modelbay/core'
import { asJson, readJson, redact, transportError, withRetry, type Method } from '@modelbay/shared'

export { asJson }
export type { Method }

export const messages = {
  cancelled: 'DeepSeek 请求已取消',
  network: 'DeepSeek 网络请求失败；提交结果可能未知，请勿自动重试',
  timeout: 'DeepSeek 请求超时；提交结果可能未知，请勿自动重试',
}

export function apiKey(ctx: AdapterContext): string {
  const key = ctx.secret('DEEPSEEK_API_KEY')?.trim()
  if (!key) throw new ProviderError('auth', '请配置 DEEPSEEK_API_KEY')
  return key
}

export function baseUrl(ctx: AdapterContext): string {
  const raw = ctx.secret('DEEPSEEK_BASE_URL')?.trim() || 'https://api.deepseek.com'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProviderError('invalid_input', 'DEEPSEEK_BASE_URL 无效')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProviderError('invalid_input', 'DEEPSEEK_BASE_URL 必须是 HTTP(S) 基础地址')
  // 配置兼容 API 的 /v1 地址时，工具接口仍只能带一次 /v1。
  return url.href.replace(/\/$/, '').replace(/\/v1$/, '')
}

export function errorInfo(value: unknown, status: number, ctx: AdapterContext): ProviderError {
  const root = asJson(value)
  const error = asJson(root.error ?? root)
  const text = redact(
    typeof error.message === 'string' ? error.message : `DeepSeek 请求失败（HTTP ${status}）`,
    [ctx.secret('DEEPSEEK_API_KEY')],
    { tokens: true },
  )
  const code =
    status === 401 || status === 403
      ? 'auth'
      : status === 402
        ? 'quota'
        : status === 429
          ? 'rate_limit'
          : status === 408 || status === 504
            ? 'timeout'
            : status >= 500
              ? 'unavailable'
              : /content_filter|content_policy|safety|content exists risk/i.test(
                    `${String(error.code)} ${text}`,
                  )
                ? 'content_policy'
                : status >= 400
                  ? 'invalid_input'
                  : 'unknown'
  return new ProviderError(code, text, {
    cause: {
      status,
      code: redact(String(error.code ?? ''), [ctx.secret('DEEPSEEK_API_KEY')], { tokens: true }),
    },
  })
}

/** 所有生成 POST 都只发送一次，凭据只发到配置的基础地址。 */
export async function sendRequest(
  ctx: AdapterContext,
  path: string,
  method: Method,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('..'))
    throw new ProviderError('invalid_input', 'DeepSeek 端点路径无效')
  if (ctx.signal.aborted) throw new ProviderError('cancelled', messages.cancelled)
  let response: Response
  try {
    response = await ctx.fetch(`${baseUrl(ctx)}${path}`, {
      method,
      headers: { ...headers, Authorization: `Bearer ${apiKey(ctx)}` },
      ...(body === undefined ? {} : { body }),
      signal: ctx.signal,
      redirect: 'error',
    })
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause
    throw transportError(ctx, method, cause, messages)
  }
  ctx.submission?.response({ httpStatus: response.status })
  if (!response.ok) {
    const data = await readJson(ctx, response, method, messages)
    throw withRetry(errorInfo(data, response.status, ctx), method, response.status)
  }
  return response
}

export async function readJsonResponse(
  ctx: AdapterContext,
  response: Response,
  method: Method = 'POST',
): Promise<Record<string, unknown>> {
  const value = await readJson(ctx, response, method, messages)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProviderError('unknown', 'DeepSeek 返回无效 JSON；请勿自动重新提交', {
      retryable: false,
      ...(method === 'POST' ? { outcome: 'unknown' as const } : {}),
    })
  const root = asJson(value)
  if (root.error) throw withRetry(errorInfo(root, 200, ctx), method)
  return root
}

export async function requestJson(
  ctx: AdapterContext,
  path: string,
  method: Method,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return readJsonResponse(
    ctx,
    await sendRequest(
      ctx,
      path,
      method,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? {} : { 'Content-Type': 'application/json' },
    ),
    method,
  )
}
