import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  createRealtimeEvent,
  InMemoryRealtimeSession,
  openRealtimeSession,
  parseRealtimeEvent,
  REALTIME_DIALOGUE_PATH,
  REALTIME_BIDIRECTION_PATH,
  REALTIME_SEED_PATH,
  validateRealtimeVideo,
} from '../src/session'
import { fakeContext } from './helpers'

const encoder = new TextEncoder()

describe('Realtime session (separate from submit/poll)', () => {
  it('in-memory placeholder delivers sent frames and tracks state', async () => {
    const session = new InMemoryRealtimeSession({ resourceId: 's1' })
    expect(session.id).toBe('s1')
    expect(session.state).toBe('open')
    const pending = session.receive()
    session.send(new Uint8Array([1, 2]))
    expect([...(await pending)]).toEqual([1, 2])
    session.send(new Uint8Array([3]))
    expect([...(await session.receive())]).toEqual([3])
    session.close()
    expect(session.state).toBe('closed')
    expect(() => session.send(new Uint8Array([4]))).toThrow(ProviderError)
    await expect(session.receive()).rejects.toMatchObject({ code: 'cancelled' })
    session.close()
  })
  it('exposes the official realtime endpoints', () => {
    expect(REALTIME_DIALOGUE_PATH).toBe('/api/v3/duplex/realtime/dialogue')
    expect(REALTIME_SEED_PATH).toBe('/api/v3/seedrealtime')
    expect(REALTIME_BIDIRECTION_PATH).toBe('/api/v3/tts/bidirection')
  })
})

describe('createRealtimeEvent（官方 session.create）', () => {
  it('填上官方默认值', () => {
    const event = createRealtimeEvent({ audio: { output: { voice: 'zh_female' } } })
    expect(event.type).toBe('session.create')
    expect(event.event_id).toMatch(/[0-9a-f-]{36}/)
    expect(event.session).toMatchObject({
      model: '1.2.6.1',
      audio: {
        input: { format: { type: 'pcm', rate: 16000 } },
        output: { format: { type: 'pcm_s16le', rate: 24000 }, voice: 'zh_female' },
      },
    })
  })
  it('seed 模式用另一个模型号', () => {
    const event = createRealtimeEvent({ audio: { output: { voice: 'v' } } }, { mode: 'seed' })
    expect(event.session).toMatchObject({ model: '1.3.0.0' })
  })
  it('校验模型号、采样率、格式与音色', () => {
    expect(() => createRealtimeEvent({ model: '9.9.9.9' })).toThrow(/session.model/)
    expect(() => createRealtimeEvent({ video: {} })).toThrow(/extension.video/)
    expect(() => createRealtimeEvent({ audio: { output: {} } })).toThrow(/voice/)
    expect(() =>
      createRealtimeEvent({
        audio: { input: { format: { type: 'pcm', rate: 24000 } }, output: { voice: 'v' } },
      }),
    ).toThrow(/16000 Hz/)
    expect(() =>
      createRealtimeEvent({
        audio: { input: { format: { type: 'mp3', rate: 16000 } }, output: { voice: 'v' } },
      }),
    ).toThrow(/pcm or speech_opus/)
    expect(() =>
      createRealtimeEvent({
        audio: { output: { voice: 'v', format: { type: 'pcm', rate: 16000 } } },
      }),
    ).toThrow(/24000 Hz/)
  })
  it('opus 是 speech_opus 的旧写法', () => {
    const event = createRealtimeEvent({
      audio: { input: { format: { type: 'opus', rate: 16000 } }, output: { voice: 'v' } },
    })
    expect(event.session).toMatchObject({
      audio: { input: { format: { type: 'speech_opus', rate: 16000 } } },
    })
  })
  it('视频输入只支持 seed 模式', () => {
    expect(() =>
      createRealtimeEvent(
        { audio: { output: { voice: 'v' } } },
        {
          extension: { video: { frame_format: 'PNG' } },
        },
      ),
    ).toThrow(/mode=seed/)
    const event = createRealtimeEvent(
      { audio: { output: { voice: 'v' } } },
      { mode: 'seed', extension: { video: { frame_format: 'PNG', frame_rate: 1 } } },
    )
    expect(event.extension).toMatchObject({ video: { frame_format: 'PNG', frame_rate: 1 } })
    expect(() => validateRealtimeVideo({ frame_format: 'GIF' }, 'seed')).toThrow(/PNG or JPEG/)
    expect(() => validateRealtimeVideo({ frame_format: 'PNG', frame_rate: 0 }, 'seed')).toThrow(
      /frame_rate/,
    )
    expect(() => validateRealtimeVideo({ frame_format: 'PNG', frame_rate: 3 }, 'seed')).toThrow(
      /frame_rate/,
    )
  })
})

describe('parseRealtimeEvent', () => {
  it('解析 JSON 文本帧', () => {
    expect(parseRealtimeEvent(encoder.encode('{"type":"session.created"}'))).toEqual({
      type: 'session.created',
    })
  })
  it('空帧、非法 JSON 与缺 type 的事件都拒绝', () => {
    expect(() => parseRealtimeEvent(new Uint8Array())).toThrow(/空事件/)
    expect(() => parseRealtimeEvent(encoder.encode('nope'))).toThrow(/JSON/)
    expect(() => parseRealtimeEvent(encoder.encode('{"a":1}'))).toThrow(/type/)
  })
})

describe('openRealtimeSession', () => {
  it('requires credentials', async () => {
    const { ctx } = fakeContext([], { secrets: {} })
    await expect(openRealtimeSession(ctx)).rejects.toMatchObject({ code: 'auth' })
  })
  it('发出 session.create 并等到 session.created 才算建连成功', async () => {
    const { ctx } = fakeContext()
    const sent: Uint8Array[] = []
    const socket = async (url: string, headers: Record<string, string>) => {
      expect(url).toBe('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue')
      expect(headers['X-Api-Key']).toBe('<redacted>')
      return {
        logId: 'log-1',
        send: (data: Uint8Array) => sent.push(data),
        receive: async () => encoder.encode('{"type":"session.created","session":{"id":"s1"}}'),
        close: () => {},
      }
    }
    const session = await openRealtimeSession(
      ctx,
      { session: { audio: { output: { voice: 'zh_female' } } } },
      socket,
    )
    expect(session.id).toBe('log-1')
    expect(session.state).toBe('open')
    expect(session.event).toMatchObject({ type: 'session.create' })
    expect(JSON.parse(new TextDecoder().decode(sent[0]))).toMatchObject({
      type: 'session.create',
      session: { model: '1.2.6.1' },
    })
    session.close()
    expect(session.state).toBe('closed')
  })
  it('回执不是 session.created 时不把半开的会话交出去', async () => {
    const { ctx } = fakeContext()
    const socket = async () => ({
      send: () => {},
      receive: async () => encoder.encode('{"type":"error"}'),
      close: () => {},
    })
    await expect(openRealtimeSession(ctx, {}, socket)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
