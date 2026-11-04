/** Shared test helpers for the Doubao Speech adapter (not part of the published API). */
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
    /** Single JSON object response. */
    body?: Record<string, unknown>
    /** Raw chunked / SSE text response. */
    text?: string
  }
}

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url))

export function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as Fixture
}

/** Build the Response recorded in a fixture (raw text wins over a JSON body). */
export function fixtureReply(f: Fixture): Response {
  const text = f.response.text ?? JSON.stringify(f.response.body ?? {})
  return new Response(text, { status: f.response.status, headers: f.response.headers })
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
  const secrets = opts.secrets ?? { DOUBAO_API_KEY: '<redacted>' }
  const ctx: AdapterContext = {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    secret: (name) => secrets[name],
    signal: opts.signal ?? new AbortController().signal,
    log: vi.fn(),
    assets: {
      load: vi.fn(async () => ({
        data: opts.data ?? new Uint8Array([1, 2, 3]),
        mime: opts.mime ?? 'audio/wav',
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
