import { describe, expect, it } from 'vite-plus/test'
import { gzipSync } from 'node:zlib'
import { ProviderError } from '@modelbay/core'
import { decodeAsrFrame, encodeAsrFrame, nodeAsrTodo } from '../src/node/asr'

/** Build a valid type-9 response frame (gzip payload, final flag set). */
function responseFrame(payload: Record<string, unknown>): Uint8Array {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload)))
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (9 << 4) | 3
  header[2] = 0x11
  header.writeInt32BE(1, 4)
  header.writeUInt32BE(compressed.length, 8)
  return new Uint8Array(Buffer.concat([header, compressed]))
}

describe('Node-only ASR frame codec', () => {
  it('encodeAsrFrame produces a 12-byte header and gzip payload', () => {
    const frame = encodeAsrFrame({ type: 1, sequence: 1, payload: new Uint8Array([1, 2, 3]) })
    expect(frame[0]).toBe(0x11)
    expect(frame.length).toBeGreaterThan(12)
    expect(frame[8]).not.toBeUndefined()
  })
  it('decodeAsrFrame parses a response frame', () => {
    expect(decodeAsrFrame(responseFrame({ result: { text: 'hi' } }))).toEqual({
      final: true,
      type: 9,
      data: { result: { text: 'hi' } },
    })
  })
  it('decodeAsrFrame rejects truncated / error frames', () => {
    expect(() => decodeAsrFrame(new Uint8Array([1, 2]))).toThrow(ProviderError)
    const errorFrame = Buffer.alloc(12)
    errorFrame[0] = 0x11
    errorFrame[1] = (15 << 4) | 1
    errorFrame[2] = 0x01
    errorFrame.writeUInt32BE(45000001, 4)
    expect(() => decodeAsrFrame(new Uint8Array(errorFrame))).toThrow(ProviderError)
  })
  it('marks the WebSocket transport as a TODO', () => {
    expect(() => nodeAsrTodo()).toThrow(ProviderError)
  })
})
