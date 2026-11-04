/** Shared test helpers for the Bailian adapter (not part of the published API). */
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
    headers?: Record<string, string>
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

/** A fake `AdapterContext` whose fetch returns queued replies in order. */
export function fakeContext(replies: Reply[] = [], opts: FakeOptions = {}) {
  const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => {
    if (!replies.length) throw new Error('Unexpected fetch')
    const next = replies.shift()!
    if (next instanceof Error) throw next
    if (next instanceof Response) return next
    return Response.json(next, { status: 200 })
  })
  const secrets = opts.secrets ?? { BAILIAN_API_KEY: '<redacted>' }
  const ctx: AdapterContext = {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    secret: (name) => secrets[name],
    signal: opts.signal ?? new AbortController().signal,
    log: vi.fn(),
    assets: {
      load: vi.fn(async () => ({
        data: opts.data ?? new Uint8Array([1, 2, 3]),
        mime: opts.mime ?? 'image/png',
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
    }))
  return { ctx, fetch: fetchImpl, calls }
}

/** A Response with an explicit HTTP status. */
export function httpResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status })
}

/** A fixture reply with an arbitrary HTTP status (for error-mapping tests). */
export function fixtureReply(f: Fixture): Response {
  return Response.json(f.response.body, {
    status: f.response.status,
    headers: f.response.headers,
  })
}
