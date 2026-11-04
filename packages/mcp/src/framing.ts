/**
 * 最小 MCP stdio 帧解析：支持换行分隔的 JSON-RPC（MCP 标准）与 Content-Length 头两种形式。
 * 纯模块：不依赖 @modelbay/core，可被 vpx 子进程直接加载。
 * 所有解析按字节进行，避免 UTF-8 多字节序列被 chunk 切断。
 */
const LF = 0x0a
const CR = 0x0d
const HEADER_MARK = new TextEncoder().encode('content-length:')
const HEADER_END = new Uint8Array([CR, LF, CR, LF])
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type Framing = 'line' | 'content-length'

export interface DecodedMessage {
  message: unknown
  framing: Framing
}

function indexOfByte(buf: Uint8Array, byte: number, from = 0): number {
  for (let i = from; i < buf.length; i += 1) if (buf[i] === byte) return i
  return -1
}

function indexOfSequence(buf: Uint8Array, seq: Uint8Array): number {
  outer: for (let i = 0; i <= buf.length - seq.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) {
      if (buf[i + j] !== seq[j]) continue outer
    }
    return i
  }
  return -1
}

function startsWithIgnoreCase(buf: Uint8Array, lowerPrefix: Uint8Array): boolean {
  if (buf.length < lowerPrefix.length) return false
  for (let i = 0; i < lowerPrefix.length; i += 1) {
    const byte = buf[i] ?? 0
    const lower = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte
    if (lower !== lowerPrefix[i]) return false
  }
  return true
}

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

/** 从 Content-Length 头块里取长度；非法返回 null。 */
export function parseContentLength(headerBytes: Uint8Array): number | null {
  const lines = decode(headerBytes).split('\r\n')
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue
    const value = Number(line.slice(colon + 1).trim())
    if (Number.isInteger(value) && value >= 0) return value
  }
  return null
}

function safeParse(text: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

export class FramedReader {
  buf: Uint8Array = new Uint8Array(0)

  push(chunk: Uint8Array | string): DecodedMessage[] {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    if (bytes.length === 0) return []
    const merged = new Uint8Array(this.buf.length + bytes.length)
    merged.set(this.buf)
    merged.set(bytes, this.buf.length)
    this.buf = merged
    return this.drain()
  }

  consume(count: number): void {
    this.buf = this.buf.slice(count)
  }

  drain(): DecodedMessage[] {
    const out: DecodedMessage[] = []
    while (this.buf.length > 0) {
      if (startsWithIgnoreCase(this.buf, HEADER_MARK)) {
        const headerEnd = indexOfSequence(this.buf, HEADER_END)
        if (headerEnd < 0) break
        const length = parseContentLength(this.buf.slice(0, headerEnd))
        if (length === null) {
          // 头非法：整块（含 \r\n\r\n）丢弃，后续内容按新消息处理，避免死循环。
          this.consume(headerEnd + HEADER_END.length)
          continue
        }
        const bodyStart = headerEnd + HEADER_END.length
        const bodyEnd = bodyStart + length
        if (this.buf.length < bodyEnd) break
        const body = this.buf.slice(bodyStart, bodyEnd)
        this.consume(bodyEnd)
        const parsed = safeParse(decode(body))
        if (parsed.ok) out.push({ message: parsed.value, framing: 'content-length' })
        continue
      }
      const nl = indexOfByte(this.buf, LF)
      if (nl < 0) break
      const line = this.buf.slice(0, nl)
      this.consume(nl + 1)
      const text = decode(line).trim()
      if (!text) continue
      const parsed = safeParse(text)
      if (parsed.ok) out.push({ message: parsed.value, framing: 'line' })
    }
    return out
  }
}

/** 按请求所用的帧格式编码响应（stdio 协议，日志一律走 stderr）。 */
export function encodeMessage(value: unknown, framing: Framing): Uint8Array {
  const body = encoder.encode(JSON.stringify(value))
  if (framing === 'line') {
    const out = new Uint8Array(body.length + 1)
    out.set(body)
    out[body.length] = LF
    return out
  }
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`)
  const out = new Uint8Array(header.length + body.length)
  out.set(header)
  out.set(body, header.length)
  return out
}
