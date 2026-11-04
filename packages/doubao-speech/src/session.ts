/**
 * Realtime dialogue sessions are deliberately NOT modelled as submit/poll jobs.
 *
 * `AdapterContext` only injects `fetch`, so a real WSS transport needs a host-provided
 * socket factory. This module defines the session interface and an in-memory placeholder
 * implementation; the real transport is a documented TODO (see README).
 */
import { ProviderError, type RealtimeSession } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { API_KEY_NAMES, firstSecret, hasCredentials } from './http'

export const REALTIME_DIALOGUE_PATH = '/api/v3/duplex/realtime/dialogue'
export const REALTIME_SEED_PATH = '/api/v3/seedrealtime'
export const REALTIME_BIDIRECTION_PATH = '/api/v3/tts/bidirection'

export interface RealtimeSessionConfig {
  /** WebSocket path on `wss://openspeech.bytedance.com`. */
  path?: string
  resourceId?: string
  /** Extra headers; credentials are added by the host, never stored here. */
  headers?: Record<string, string>
}

/** A host-injected binary WebSocket factory (not part of `AdapterContext`). */
export type RealtimeSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => Promise<{
  logId?: string
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}>

export interface RealtimeSessionHandle extends RealtimeSession {
  readonly id: string
  readonly state: 'open' | 'closed'
}

/**
 * In-memory session placeholder: frames sent by the caller are queued for `receive()`.
 * Useful for tests and for hosts that have not wired a real socket yet.
 */
export class InMemoryRealtimeSession implements RealtimeSessionHandle {
  readonly id: string
  state: 'open' | 'closed' = 'open'
  private readonly queue: Uint8Array[] = []
  private readonly waiters: Array<(frame: Uint8Array) => void> = []

  constructor(config: RealtimeSessionConfig = {}) {
    this.id = config.resourceId ?? 'realtime-placeholder'
  }

  send(data: Uint8Array): void {
    if (this.state === 'closed') throw new ProviderError('cancelled', 'Realtime session is closed')
    const waiter = this.waiters.shift()
    if (waiter) waiter(data)
    else this.queue.push(data)
  }

  receive(): Promise<Uint8Array> {
    if (this.state === 'closed')
      return Promise.reject(new ProviderError('cancelled', 'Realtime session is closed'))
    const next = this.queue.shift()
    if (next) return Promise.resolve(next)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    for (const waiter of this.waiters.splice(0)) waiter(new Uint8Array())
  }
}

/**
 * Open a realtime session.
 *
 * TODO: when the host injects a `RealtimeSocketFactory`, wrap its binary socket instead
 * of returning the placeholder. Until then a real WSS connection cannot be established
 * through `ctx.fetch`; the placeholder keeps the interface usable and testable.
 */
export async function openRealtimeSession(
  ctx: AdapterContext,
  config: RealtimeSessionConfig = {},
  socket?: RealtimeSocketFactory,
): Promise<RealtimeSessionHandle> {
  const key = firstSecret(ctx, API_KEY_NAMES)
  if (!hasCredentials(ctx))
    throw new ProviderError('auth', 'Realtime session requires DOUBAO credentials')
  if (!socket) return new InMemoryRealtimeSession(config)
  const url = `wss://openspeech.bytedance.com${config.path ?? REALTIME_DIALOGUE_PATH}`
  const remote = await socket(url, { ...config.headers, ...(key ? { 'X-Api-Key': key } : {}) })
  let closed = false
  const wrapped: RealtimeSessionHandle = {
    id: remote.logId ?? config.resourceId ?? 'realtime',
    get state(): 'open' | 'closed' {
      return closed ? 'closed' : 'open'
    },
    send: (data) => {
      if (closed) throw new ProviderError('cancelled', 'Realtime session is closed')
      remote.send(data)
    },
    receive: () => remote.receive(),
    close: () => {
      closed = true
      remote.close()
    },
  }
  return wrapped
}
