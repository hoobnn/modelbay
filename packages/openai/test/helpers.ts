/** 测试共用的假宿主上下文；不联网，所有应答来自录制队列。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AdapterContext } from '@modelbay/core'
import { vi } from 'vite-plus/test'

/** 读取录制夹具（JSON，敏感字段已 <redacted>）。 */
export function fixture<T = Record<string, unknown>>(name: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export interface RecordedCall {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body?: Record<string, unknown>
  }
  response: { status: number; body: unknown }
}

// oxlint-disable-next-line typescript/no-redundant-type-constituents -- 列出常见的几种，便于阅读
export type Reply = Response | Error | unknown

export interface FakeOptions {
  /** 单个密钥或按名字查的密钥表；默认 test-secret */
  secret?: string | Record<string, string | undefined>
  signal?: AbortSignal
  assets?: AdapterContext['assets']
}

export function fakeContext(replies: Reply[] = [], opts: FakeOptions = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (!replies.length) throw new Error('Unexpected fetch')
    const next = replies.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json(next)
  })
  const secrets = opts.secret ?? 'test-secret'
  const ctx: AdapterContext = {
    fetch: fetchImpl,
    signal: opts.signal ?? new AbortController().signal,
    secret: (name) => (typeof secrets === 'string' ? secrets : secrets[name]),
    log: vi.fn(),
    ...(opts.assets ? { assets: opts.assets } : {}),
  }
  return { ctx, fetch: fetchImpl, body: (index = 0) => requestBody(fetchImpl, index) }
}

/** 第 index 次请求的 JSON 请求体。 */
export function requestBody(
  fetchImpl: { mock: { calls: unknown[][] } },
  index = 0,
): Record<string, unknown> {
  const init = fetchImpl.mock.calls[index]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function aborted(reason?: unknown): AbortSignal {
  const controller = new AbortController()
  controller.abort(reason)
  return controller.signal
}
