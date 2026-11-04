import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  InMemoryRealtimeSession,
  openRealtimeSession,
  REALTIME_DIALOGUE_PATH,
  REALTIME_BIDIRECTION_PATH,
  REALTIME_SEED_PATH,
} from '../src/session'
import { fakeContext } from './helpers'

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
  it('openRealtimeSession returns the placeholder without a socket factory', async () => {
    const { ctx } = fakeContext()
    const session = await openRealtimeSession(ctx, { resourceId: 'plan' })
    expect(session).toBeInstanceOf(InMemoryRealtimeSession)
    expect(session.id).toBe('plan')
  })
  it('openRealtimeSession requires credentials', async () => {
    const { ctx } = fakeContext([], { secrets: {} })
    await expect(openRealtimeSession(ctx)).rejects.toMatchObject({ code: 'auth' })
  })
  it('openRealtimeSession wraps a host-injected socket', async () => {
    const { ctx } = fakeContext()
    const socket = async (url: string, headers: Record<string, string>) => {
      expect(url).toContain('wss://openspeech.bytedance.com')
      expect(headers['X-Api-Key']).toBe('<redacted>')
      return {
        logId: 'log-1',
        send: () => {},
        receive: async () => new Uint8Array([9]),
        close: () => {},
      }
    }
    const session = await openRealtimeSession(ctx, {}, socket)
    expect(session.id).toBe('log-1')
    expect(session.state).toBe('open')
    expect([...(await session.receive())]).toEqual([9])
    session.close()
    expect(session.state).toBe('closed')
  })
})
