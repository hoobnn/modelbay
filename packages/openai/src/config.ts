/**
 * Configuration helpers for the OpenAI-compatible channel. Pure URL validation
 * so it can run in any runtime; no Node-only imports here.
 */
import { ProviderError } from '@modelbay/core'

/** Validate a channel Base URL; remote channels must use HTTPS, HTTP only for localhost. */
export function compatibleBaseURL(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProviderError('invalid_input', 'Base URL 必须是完整的 HTTP(S) 地址')
  }
  if (url.username || url.password || url.search || url.hash)
    throw new ProviderError('invalid_input', 'Base URL 不能包含用户名、密码、查询参数或片段')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
    throw new ProviderError('invalid_input', '远端渠道必须使用 HTTPS；HTTP 仅支持 localhost')
  if (!/^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})$/.test(url.hostname))
    throw new ProviderError('invalid_input', '渠道地址须使用域名或 localhost')
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

/** Normalize a Base URL to an `https://host/.../v1`-style prefix without trailing slash. */
export function normalizedBase(raw: string): string {
  return compatibleBaseURL(raw).href.replace(/\/$/, '')
}
