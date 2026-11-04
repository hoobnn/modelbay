/**
 * Node-only Agent Plan ASR frame codec, exported from `@modelbay/ark/tos`.
 * Uses `node:zlib` for gzip; the root adapter never imports it. The streaming
 * WebSocket transport itself is a documented TODO (see README).
 */
import { gzipSync, gunzipSync } from 'node:zlib'
import { ProviderError, type AdapterContext, type SubmitResult } from '@modelbay/core'
import { asJson, type Json } from '../http'

/** Build one binary ASR frame (gzip-compressed payload + 12-byte header). */
export function asrFrame(type: number, sequence: number, payload: Uint8Array): Buffer {
  const compressed = gzipSync(payload)
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (type << 4) | (sequence < 0 ? 3 : 1)
  header[2] = type === 1 ? 0x11 : 0x01
  header.writeInt32BE(sequence, 4)
  header.writeUInt32BE(compressed.length, 8)
  return Buffer.concat([header, compressed])
}

/** Decode one binary ASR frame, validating sizes and gzip limits. */
export function asrPacket(bytes: Uint8Array): { final: boolean; data: Json } {
  const data = Buffer.from(bytes)
  const invalid = () =>
    new ProviderError('unavailable', 'Agent Plan 语音识别返回不完整数据', {
      outcome: 'unknown',
      retryable: false,
    })
  if (data.length < 8 || data[0]! >> 4 !== 1) throw invalid()
  const flags = data[1]! & 15
  const type = data[1]! >> 4
  let offset = (data[0]! & 15) * 4
  if (offset < 4) throw invalid()
  if (type === 15) {
    if (data.length < offset + 8) throw invalid()
    const code = data.readUInt32BE(offset)
    throw new ProviderError(
      code === 45000001 ? 'invalid_input' : 'unavailable',
      `Agent Plan 语音识别错误 ${code}`,
      { retryable: false },
    )
  }
  if (type !== 9) throw invalid()
  if (flags & 1) offset += 4
  if (flags & 4) offset += 4
  if (data.length < offset + 4) throw invalid()
  const size = data.readUInt32BE(offset)
  offset += 4
  if (offset + size !== data.length) throw invalid()
  let body = data.subarray(offset)
  if ((data[2]! & 15) === 1) body = gunzipSync(body, { maxOutputLength: 8 * 1024 * 1024 })
  if (data[2]! >> 4 !== 1) throw invalid()
  return { final: Boolean(flags & 2), data: asJson(JSON.parse(body.toString())) }
}

/**
 * TODO(M3): the full streaming transcription needs `ctx.socket` (WebSocket),
 * which `AdapterContext` does not expose; port it once the host provides a
 * socket hook. Until then the subpath exposes the codec and a clear error.
 */
export function transcribePlan(_ctx: AdapterContext): Promise<SubmitResult> {
  return Promise.reject(
    new ProviderError(
      'unavailable',
      'TODO: Agent Plan 流式语音识别需要宿主的 socket 钩子，暂未接入',
    ),
  )
}
