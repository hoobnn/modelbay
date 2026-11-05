/**
 * 音色试听下载：20 MB 上限 + 魔数嗅探（RIFF / OggS / fLaC / ID3 / MPEG 帧同步）。
 * 只用各运行时都有的字节操作，不用 Buffer；试听是已创建音色的附属结果，
 * 调用者须单独处理失败，不能重新创建音色。
 */
import type { AdapterContext } from '@modelbay/core'

const LIMIT = 20 * 1024 * 1024

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]! & 0x7f)
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** 响应头是 audio/* 时优先信它，否则按文件头魔数认格式。 */
function sniffMime(bytes: Uint8Array, header: string | null): string | undefined {
  const h = header?.split(';')[0]
  if (h?.startsWith('audio/')) return h
  const signature = ascii(bytes, 0, 4)
  if (signature === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return 'audio/wav'
  if (signature === 'OggS') return 'audio/ogg'
  if (signature === 'fLaC') return 'audio/flac'
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    return 'audio/mpeg'
  return undefined
}

export async function downloadVoicePreview(
  url: string,
  ctx: Pick<AdapterContext, 'fetch' | 'signal'>,
) {
  const response = await ctx.fetch(url, { signal: ctx.signal })
  if (!response.ok || !response.body) throw new Error('试听下载失败')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > LIMIT) throw new Error('试听文件过大')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (!size) throw new Error('试听为空')
  const bytes = concat(chunks)
  const mime = sniffMime(bytes, response.headers.get('content-type'))
  if (!mime) throw new Error('试听不是有效音频')
  return { data: bytes, mime }
}
