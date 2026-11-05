import { describe, expect, it } from 'vite-plus/test'
import { gzipSync } from 'node:zlib'
import { ProviderError } from '@modelbay/core'
import {
  asrHeaders,
  asrPayload,
  asrSegments,
  decodeAsrFrame,
  encodeAsrFrame,
  runAsrStream,
  transcribeStream,
  type AsrSocket,
} from '../src/node/asr'
import { readPcm } from '../src/node/pcm'
import { fakeContext } from './helpers'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Build a valid type-9 response frame (gzip payload, final flag set). */
function responseFrame(payload: Record<string, unknown>, final = true): Uint8Array {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload)))
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (9 << 4) | (final ? 3 : 1)
  header[2] = 0x11
  header.writeInt32BE(1, 4)
  header.writeUInt32BE(compressed.length, 8)
  return new Uint8Array(Buffer.concat([header, compressed]))
}

/** 一个假 socket：记录发出去的帧，按队列返回收到的帧。 */
function fakeSocket(frames: Uint8Array[] = []) {
  const sent: Uint8Array[] = []
  const socket: AsrSocket = {
    send: (data) => {
      sent.push(data)
    },
    receive: async () => frames.shift() ?? new Uint8Array(),
    close: () => undefined,
  }
  return { socket, sent }
}

/**
 * 构造一个错误帧（类型 15）。
 *
 * 帧头之后按官方文档依次是：4 字节序号（标志位 0x1 时存在）、4 字节错误码、
 * 4 字节负载长度、负载。
 */
function errorFrame(code: number, message = 'denied'): Uint8Array {
  const compressed = gzipSync(Buffer.from(JSON.stringify({ message })))
  const header = Buffer.alloc(16)
  header[0] = 0x11
  header[1] = (15 << 4) | 1
  header[2] = 0x01
  header.writeInt32BE(1, 4)
  header.writeUInt32BE(code, 8)
  header.writeUInt32BE(compressed.length, 12)
  return new Uint8Array(Buffer.concat([header, compressed]))
}

/** 读帧头里的序号（4 字节大端有符号整数）。 */
function frameSequence(frame: Uint8Array): number {
  return Buffer.from(frame).readInt32BE(4)
}

/** 写一个 WAV 文件，返回路径。 */
function writeWav(ms: number, rate = 16000, channel = 1): string {
  const dir = mkdtempSync(join(tmpdir(), 'modelbay-asr-'))
  const path = join(dir, 'audio.wav')
  const samples = (rate * ms) / 1000
  const data = Buffer.alloc(samples * channel * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channel, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channel * 2, 28)
  header.writeUInt16LE(channel * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
  return path
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
    expect(() => decodeAsrFrame(errorFrame(45000001))).toThrow(ProviderError)
  })
})

describe('流式识别：请求体与分片', () => {
  it('asrHeaders 带齐官方要求的请求头', () => {
    const headers = asrHeaders('speech-key', { requestId: 'req-1', resourceId: 'custom' })
    expect(headers['X-Api-Key']).toBe('speech-key')
    expect(headers['X-Api-Resource-Id']).toBe('custom')
    expect(headers['X-Api-Request-Id']).toBe('req-1')
    expect(headers['X-Api-Sequence']).toBe('-1')
    expect(asrHeaders('k')['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')
  })

  it('asrPayload 按官方协议给出 user/audio/request 三段', () => {
    const payload = asrPayload({ data: new Uint8Array([0, 0]), rate: 16000, bits: 16, channel: 1 })
    expect(payload.user).toEqual({ uid: 'modelbay' })
    expect(payload.audio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 })
    expect(payload.request).toMatchObject({ model_name: 'bigmodel' })
  })

  it('asrPayload 拒绝非 16-bit、多声道与未对齐的音频', () => {
    expect(() =>
      asrPayload({ data: new Uint8Array([0]), rate: 16000, bits: 8, channel: 1 }),
    ).toThrow(/16-bit/)
    expect(() =>
      asrPayload({ data: new Uint8Array([0, 0]), rate: 16000, bits: 16, channel: 3 }),
    ).toThrow(/声道/)
    expect(() =>
      asrPayload({ data: new Uint8Array([0]), rate: 16000, bits: 16, channel: 1 }),
    ).toThrow(/对齐/)
  })

  it('asrSegments 按 200ms 一片切分音频', () => {
    const pcm = { data: new Uint8Array(16000 * 2), rate: 16000, bits: 16, channel: 1 }
    const segments = asrSegments(pcm)
    expect(segments).toHaveLength(5)
    expect(segments[0]?.length).toBe(6400)
    expect(asrSegments(pcm, { segmentMs: 100 })).toHaveLength(10)
  })

  it('readPcm 读本地 WAV 并剥掉容器头', () => {
    const pcm = readPcm(writeWav(100))
    expect(pcm.rate).toBe(16000)
    expect(pcm.channel).toBe(1)
    expect(pcm.data.length).toBe(3200)
  })
})

describe('流式识别：真实 WSS 会话', () => {
  it('发完整请求与音频片，收识别文本', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'speech-key' } })
    const { socket, sent } = fakeSocket([
      responseFrame({ result: { text: '中间结果' } }, false),
      responseFrame({ result: { text: '最终结果' } }),
    ])
    const result = await transcribeStream(
      ctx,
      { audio: writeWav(600), mode: 'realtime', pace: false },
      async (url, headers) => {
        expect(url).toBe('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async')
        expect(headers['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')
        return socket
      },
    )
    expect(result.text).toBe('最终结果')
    expect(result.messages).toHaveLength(2)
    // 第一帧是完整客户端请求（类型 1），后面是音频片（类型 2）
    expect((sent[0]?.[1] ?? 0) >> 4).toBe(1)
    expect((sent[1]?.[1] ?? 0) >> 4).toBe(2)
    // 音频片序号从 2 开始，最后一片用负序号标记结束
    expect(frameSequence(sent[1] ?? new Uint8Array())).toBe(2)
    const last = sent[sent.length - 1] ?? new Uint8Array()
    expect(frameSequence(last)).toBeLessThan(0)
  })

  it('sentence 模式走单流接口', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'speech-key' } })
    const { socket } = fakeSocket([responseFrame({ result: { text: '一句话' } })])
    const result = await transcribeStream(
      ctx,
      { audio: writeWav(200), mode: 'sentence', pace: false },
      async (url) => {
        expect(url).toBe('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream')
        return socket
      },
    )
    expect(result.text).toBe('一句话')
  })

  it('缺凭证时报 auth，不建连', async () => {
    const { ctx } = fakeContext([], { secrets: {} })
    await expect(
      transcribeStream(ctx, { audio: writeWav(100) }, async () => fakeSocket().socket),
    ).rejects.toMatchObject({ code: 'auth' })
  })

  it('非法 mode 报错', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    await expect(
      transcribeStream(
        ctx,
        { audio: writeWav(100), mode: 'bogus' as 'realtime' },
        async () => fakeSocket().socket,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('服务端报错帧按错误码抛 ProviderError', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    const { socket } = fakeSocket([errorFrame(45000001)])
    await expect(
      transcribeStream(ctx, { audio: writeWav(100), pace: false }, async () => socket),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('没有识别结果时报错', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    const { socket } = fakeSocket([responseFrame({ result: {} })])
    await expect(
      transcribeStream(ctx, { audio: writeWav(100), pace: false }, async () => socket),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})

describe('runAsrStream：speech_raw_request 的 asr_stream 分支', () => {
  it('返回识别文本与消息', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    const { socket } = fakeSocket([responseFrame({ result: { text: '识别结果' } })])
    const result = await runAsrStream(
      ctx,
      { product: 'asr_stream', audio: writeWav(100), mode: 'realtime' },
      async () => socket,
    )
    expect(result).toMatchObject({ ok: true, text: '识别结果' })
  })

  it('缺 audio 路径时报 invalid_input', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    await expect(runAsrStream(ctx, { product: 'asr_stream' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
