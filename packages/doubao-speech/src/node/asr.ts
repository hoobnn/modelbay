/**
 * Node-only streaming ASR frame codec (`@modelbay/doubao-speech/asr`).
 *
 * The Doubao/Volcengine streaming ASR protocol gzip-compresses each JSON/audio frame
 * behind a 12-byte binary header. `node:zlib` and `Buffer` are Node-specific, so this
 * module is intentionally kept out of the root entry and exported from an optional
 * subpath. TODO: wire it to a host-injected WebSocket session (see the package README).
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { ProviderError } from '@modelbay/core'

export interface AsrFrame {
  /** Frame type: 1 = JSON request, 2 = audio chunk, 9 = response, 15 = error. */
  type: number
  /** Monotonic sequence; negative marks the last audio frame. */
  sequence: number
  payload: Uint8Array
}

/** Serialize a frame: 12-byte header followed by gzip-compressed payload. */
export function encodeAsrFrame(frame: AsrFrame): Uint8Array {
  const compressed = gzipSync(Buffer.from(frame.payload))
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (frame.type << 4) | (frame.sequence < 0 ? 3 : 1)
  header[2] = frame.type === 1 ? 0x11 : 0x01
  header.writeInt32BE(frame.sequence, 4)
  header.writeUInt32BE(compressed.length, 8)
  return new Uint8Array(Buffer.concat([header, compressed]))
}

export interface DecodedAsrFrame {
  final: boolean
  type: number
  data: Record<string, unknown>
}

/** Parse a response frame (type 9) or throw a normalized ProviderError. */
export function decodeAsrFrame(bytes: Uint8Array): DecodedAsrFrame {
  const invalid = () =>
    new ProviderError('unavailable', 'Streaming ASR returned incomplete data', {
      outcome: 'unknown',
      retryable: false,
    })
  const data = Buffer.from(bytes)
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
      `Streaming ASR error ${code}`,
      {
        retryable: false,
      },
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
  return {
    final: Boolean(flags & 2),
    type,
    data: JSON.parse(body.toString()) as Record<string, unknown>,
  }
}

/** TODO: attach the codec to a real WSS session opened via `openRealtimeSession`. */
export function nodeAsrTodo(): never {
  throw new ProviderError('unavailable', 'Streaming ASR WebSocket transport is not implemented yet')
}
