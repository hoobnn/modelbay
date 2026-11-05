import { ProviderError, type ProviderUsage } from '@modelbay/core'
import { asJson, type Json } from './http'

/** Decode a hex-encoded audio payload without Node's Buffer. */
export function fromHex(text: string, label = '音频'): Uint8Array {
  if (!text || !/^(?:[a-f\d]{2})+$/i.test(text))
    throw new ProviderError('unknown', `MiniMax 响应缺少有效 hex ${label}`, { retryable: false })
  const bytes = new Uint8Array(text.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function usage(data: Json): ProviderUsage {
  const u = asJson(data.usage)
  const extra = asJson(data.extra_info)
  return {
    ...(typeof u.prompt_tokens === 'number' ? { inputTokens: u.prompt_tokens } : {}),
    ...(typeof u.completion_tokens === 'number' ? { outputTokens: u.completion_tokens } : {}),
    ...(typeof extra.usage_characters === 'number' ? { characters: extra.usage_characters } : {}),
    ...(typeof extra.audio_length === 'number' ? { seconds: extra.audio_length / 1000 } : {}),
  }
}

export function required(value: string, max: number, label: string): void {
  if (!value.trim() || value.length > max)
    throw new ProviderError('invalid_input', `${label}须为 1–${max} 字符`)
}

export function taskId(value: unknown): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(id))
    throw new ProviderError('invalid_input', '无效 MiniMax task ID')
  return id
}

export const sensitive = (value: unknown): boolean =>
  typeof value === 'object' && value !== null
    ? (value as { type?: number }).type !== 0
    : value === true

/**
 * MCP 工具参数的位置：MCP 把工具参数原样作为 `input`（`vol`、`pitch`、`parameters` 等），
 * SDK 宿主则放在 `input.extra`。这里合并三处（顶层 < parameters < extra），
 * 调用方只按各自的白名单取值，白名单外的字段一律不透传。
 */
export function optionSource(input: object): Json {
  const top = input as Json
  const { extra, parameters, ...rest } = top
  return { ...rest, ...asJson(parameters), ...asJson(extra) }
}

/** 取白名单键；值为 null / undefined 视为没给。 */
export function pickKeys(source: Json, keys: readonly string[]): Json {
  const out: Json = {}
  for (const key of keys)
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  return out
}
