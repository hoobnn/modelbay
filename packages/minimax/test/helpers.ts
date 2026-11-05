/** Shared test helpers for the MiniMax adapter (not part of the published API). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AdapterContext } from '@modelbay/core'
import { vi } from 'vite-plus/test'

export interface Fixture {
  note: string
  request: {
    url: string
    method: string
    headers: Record<string, string>
    body?: Record<string, unknown>
  }
  response: {
    status: number
    body: Record<string, unknown>
  }
}

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url))

export function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as Fixture
}

export type Reply = Response | Error | Record<string, unknown>

export interface FakeOptions {
  secrets?: Record<string, string | undefined>
  mime?: string
  data?: Uint8Array
  signal?: AbortSignal
}

export function fakeContext(replies: Reply[] = [], opts: FakeOptions = {}) {
  const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => {
    if (!replies.length) throw new Error('Unexpected fetch')
    const next = replies.shift()!
    if (next instanceof Error) throw next
    if (next instanceof Response) return next
    return Response.json(next, { status: 200 })
  })
  const secrets = opts.secrets ?? { MINIMAX_API_KEY: '<redacted>' }
  const ctx: AdapterContext = {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    secret: (name) => secrets[name],
    signal: opts.signal ?? new AbortController().signal,
    log: vi.fn(),
    assets: {
      load: vi.fn(async () => ({
        data: opts.data ?? new Uint8Array([1, 2, 3]),
        mime: opts.mime ?? 'audio/mpeg',
      })),
    },
  }
  const calls = () =>
    fetchImpl.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: (init as RequestInit | undefined)?.method,
      headers: (init as RequestInit | undefined)?.headers as Record<string, string> | undefined,
      body:
        typeof (init as RequestInit | undefined)?.body === 'string'
          ? JSON.parse((init as RequestInit).body as string)
          : undefined,
      rawBody: (init as RequestInit | undefined)?.body,
    }))
  return { ctx, fetch: fetchImpl, calls }
}

export function httpResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status })
}

export function fixtureReply(f: Fixture): Response {
  return Response.json(f.response.body, { status: f.response.status })
}

export interface HostOptions {
  secret?: string
  settings?: Record<string, unknown>
  mime?: string
  width?: number
  height?: number
  duration?: number
}

/**
 * 模拟宿主：透传 `settings`（region / voice）与带媒体元数据的 `files.read`，
 * 没有 `assets`。回复队列用完再请求会报错。
 */
export function hostContext(replies: Reply[] = [], opts: HostOptions = {}) {
  const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => {
    if (!replies.length) throw new Error('Unexpected fetch')
    const next = replies.shift()!
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json(next)
  })
  const ctx: AdapterContext = {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    secret: (name) => (name === 'MINIMAX_API_KEY' ? (opts.secret ?? 'test-key') : undefined),
    signal: new AbortController().signal,
    log: vi.fn(),
    settings: { region: 'cn', voice: 'male-qn-qingse', ...opts.settings },
    files: {
      read: vi.fn(async () => ({
        data: new Uint8Array([1, 2, 3]),
        mime: opts.mime ?? 'image/png',
        width: opts.width ?? 1024,
        height: opts.height ?? 1024,
        duration: opts.duration,
      })),
    },
  }
  const body = (index = 0) => {
    const init = fetchImpl.mock.calls[index]?.[1] as RequestInit | undefined
    return JSON.parse(String(init?.body))
  }
  return { ctx, fetch: fetchImpl, body }
}
