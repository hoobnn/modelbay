/**
 * 同传链路的测试：protobuf 编解码 + WSS 会话。
 *
 * 服务端帧是录制的：用 Python 版官方 protobuf（data.speech.ast.TranslateResponse）
 * 编出来存在 `test/fixtures/ast-frames.json`，这里用 TypeScript 的解码器解，
 * 保证两边说的是同一种协议。socket 是假的，不联网。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  AST_EVENT,
  decodeTranslateRequest,
  decodeTranslateResponse,
  encodeTranslateRequest,
} from '../src/node/ast'
import {
  interpretAudio,
  INTERPRETATION_CHUNK_BYTES,
  INTERPRETATION_ENDPOINT,
  INTERPRETATION_RESOURCE_ID,
  readPcm,
  type InterpretationSocket,
} from '../src/node/interpretation'
import { fakeContext } from './helpers'

interface Frames {
  note: string
  frames: Record<string, string>
}

function recordedFrames(): Frames {
  return JSON.parse(
    readFileSync(new URL('./fixtures/ast-frames.json', import.meta.url), 'utf8'),
  ) as Frames
}

function frame(name: string): Uint8Array {
  const base64 = recordedFrames().frames[name]
  if (!base64) throw new Error(`缺少录制的帧：${name}`)
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

describe('同传 protobuf 编解码', () => {
  it('解出录制的服务端帧：事件号、文本与时间', () => {
    const started = decodeTranslateResponse(frame('session_started'))
    expect(started.event).toBe(AST_EVENT.SessionStarted)
    expect(started.sessionId).toBe('sess-1')

    const source = decodeTranslateResponse(frame('source_end'))
    expect(source.event).toBe(AST_EVENT.SourceSubtitleEnd)
    expect(source.text).toBe('。')
    expect(source.endTime).toBe(2000)

    const usage = decodeTranslateResponse(frame('usage'))
    expect(usage.event).toBe(AST_EVENT.UsageResponse)
    expect(usage.billing).toMatchObject({ duration_msec: 2000, word_count: 12 })

    const failed = decodeTranslateResponse(frame('session_failed'))
    expect(failed.event).toBe(AST_EVENT.SessionFailed)
    expect(failed.statusCode).toBe(45000001)
    expect(failed.message).toBe('参数无效')
  })

  it('编出的请求能被自己解出来（字段号与官方一致）', () => {
    const bytes = encodeTranslateRequest({
      requestMeta: { sessionId: 'sess-1', resourceId: INTERPRETATION_RESOURCE_ID },
      event: AST_EVENT.StartSession,
      user: { uid: 'modelbay' },
      sourceAudio: { format: 'wav', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
      request: {
        mode: 's2t',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        corpus: { hotWords: ['火山引擎'], glossary: [{ key: '火山引擎', value: 'Volcengine' }] },
      },
    })
    const decoded = decodeTranslateRequest(bytes)
    expect(decoded.event).toBe(AST_EVENT.StartSession)
    expect(decoded.requestMeta?.sessionId).toBe('sess-1')
    expect(decoded.sourceAudio).toMatchObject({ format: 'wav', rate: 16000, bits: 16, channel: 1 })
    expect(decoded.request).toMatchObject({
      mode: 's2t',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    })
    expect(decoded.request?.corpus?.hotWords).toEqual(['火山引擎'])
    expect(decoded.request?.corpus?.glossary).toEqual([{ key: '火山引擎', value: 'Volcengine' }])
  })
})

describe('读本地音频', () => {
  it('裸 PCM 按 16kHz/16bit/单声道处理', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-'))
    const path = join(dir, 'a.pcm')
    writeFileSync(path, Buffer.alloc(INTERPRETATION_CHUNK_BYTES, 1))
    const pcm = readPcm(path)
    expect(pcm.rate).toBe(16000)
    expect(pcm.bits).toBe(16)
    expect(pcm.channel).toBe(1)
    expect(pcm.data.length).toBe(INTERPRETATION_CHUNK_BYTES)
  })
  it('WAV 会剥掉容器头', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-'))
    const path = join(dir, 'a.wav')
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(32000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(8, 40)
    writeFileSync(path, Buffer.concat([header, Buffer.alloc(8, 2)]))
    const pcm = readPcm(path)
    expect(pcm.rate).toBe(16000)
    expect(pcm.data.length).toBe(8)
  })
  it('不认识的格式直接拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-'))
    const path = join(dir, 'a.mp3')
    writeFileSync(path, Buffer.alloc(4))
    expect(() => readPcm(path)).toThrow(ProviderError)
  })
})

describe('同传会话（假 socket，不联网）', () => {
  function fakeSocket(names: string[]) {
    const sent: Uint8Array[] = []
    const queue = names.map(frame)
    let url = ''
    let headers: Record<string, string> = {}
    const socket: InterpretationSocket = {
      send: (data) => sent.push(data),
      receive: async () => queue.shift() ?? new Uint8Array(),
      close: () => undefined,
    }
    return {
      socket,
      sent,
      factory: async (u: string, h: Record<string, string>) => {
        url = u
        headers = h
        return socket
      },
      get url() {
        return url
      },
      get headers() {
        return headers
      },
    }
  }

  function writePcm(bytes: number): string {
    const dir = mkdtempSync(join(tmpdir(), 'ast-'))
    const path = join(dir, 'a.pcm')
    writeFileSync(path, Buffer.alloc(bytes, 3))
    return path
  }

  it('开始会话 → 上传音频 → 收字幕与用量 → 结束会话', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    const fake = fakeSocket([
      'session_started',
      'source_start',
      'source_delta',
      'source_end',
      'translation_start',
      'translation_delta',
      'translation_end',
      'tts',
      'usage',
      'session_finished',
    ])
    const result = await interpretAudio(
      ctx,
      {
        audio: writePcm(INTERPRETATION_CHUNK_BYTES),
        source_language: 'zh',
        target_language: 'en',
        pace: false,
      },
      fake.factory,
    )
    expect(fake.url).toBe(INTERPRETATION_ENDPOINT)
    expect(fake.headers['X-Api-Resource-Id']).toBe(INTERPRETATION_RESOURCE_ID)
    expect(fake.headers['X-Api-Key']).toBe('k')

    // 发出去的三类请求：开始会话、音频分片、结束会话
    const requests = fake.sent.map((bytes) => decodeTranslateRequest(bytes))
    expect(requests.map((item) => item.event)).toEqual([
      AST_EVENT.StartSession,
      AST_EVENT.TaskRequest,
      AST_EVENT.FinishSession,
    ])
    expect(requests[0]?.requestMeta?.sessionId).toBeTruthy()
    expect(requests[0]?.sourceAudio).toMatchObject({ format: 'wav', rate: 16000, bits: 16 })
    expect(requests[0]?.request).toMatchObject({
      mode: 's2t',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    })
    expect(requests[1]?.sourceAudio?.binaryData?.length).toBe(INTERPRETATION_CHUNK_BYTES)

    expect(result.ok).toBe(true)
    expect(result.sourceText).toBe('你好，世界。')
    expect(result.translationText).toBe('Hello, world.')
    expect(result.sourceSegments).toHaveLength(1)
    expect(result.sourceSegments[0]?.endMs).toBe(2000)
    expect(result.audioBytes).toBe(4)
    expect(result.usage[0]).toMatchObject({ duration_msec: 2000 })
  })

  it('服务端报错时抛出并带上原因', async () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    const fake = fakeSocket(['session_failed'])
    await expect(
      interpretAudio(
        ctx,
        {
          audio: writePcm(INTERPRETATION_CHUNK_BYTES),
          source_language: 'zh',
          target_language: 'en',
          pace: false,
        },
        fake.factory,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })

  it('缺参数或缺凭证时直接拒绝', async () => {
    const { ctx } = fakeContext([], { secrets: {} })
    await expect(
      interpretAudio(ctx, {
        audio: writePcm(16),
        source_language: '',
        target_language: 'en',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const keyed = fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } })
    await expect(
      interpretAudio(keyed.ctx, {
        audio: writePcm(16),
        source_language: 'zh',
        target_language: '',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
