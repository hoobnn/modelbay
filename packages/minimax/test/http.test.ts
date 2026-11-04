import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type ProviderErrorCode } from '@modelbay/core'
import {
  apiKey,
  asJson,
  baseUrl,
  CN_BASE_URL,
  errorCode,
  GLOBAL_BASE_URL,
  isJson,
  readJson,
  readText,
  requestJson,
  requestMessages,
  retryableFor,
  scrub,
  send,
  transportError,
  withRetry,
} from '../src/http'
import { fakeContext, fixture, fixtureReply } from './helpers'

describe('JSON helpers, redaction, retry', () => {
  it('isJson / asJson', () => {
    expect(isJson({})).toBe(true)
    expect(isJson([])).toBe(false)
    expect(asJson(null)).toEqual({})
  })
  it('scrub removes known keys and generic tokens', () => {
    expect(scrub('sk-abcdefgh failed', ['sk-abcdefgh'])).not.toContain('sk-abcdefgh')
    expect(scrub('Bearer sk-abcdefgh', [])).toBe('Bearer <redacted>')
  })
  it('retryableFor / withRetry', () => {
    expect(retryableFor('GET', 'rate_limit')).toBe(true)
    expect(retryableFor('POST', 'unavailable')).toBe(false)
    expect(withRetry(new ProviderError('unavailable', 'x'), 'POST', 503).outcome).toBe('unknown')
    expect(withRetry(new ProviderError('unavailable', 'x'), 'GET', 503).outcome).toBeUndefined()
  })
  it('requestMessages differ by method', () => {
    expect(requestMessages('GET').network).not.toBe(requestMessages('POST').network)
  })
})

describe('transportError / send / read*', () => {
  const messages = { cancelled: 'cancelled', network: 'network', timeout: 'timeout' }
  it('abort, timeout and network', () => {
    const aborted = new AbortController()
    aborted.abort()
    expect(transportError({ signal: aborted.signal }, 'POST', new Error('x'), messages).code).toBe(
      'cancelled',
    )
    const timeout = new Error('t')
    timeout.name = 'TimeoutError'
    expect(
      transportError({ signal: new AbortController().signal }, 'GET', timeout, messages).code,
    ).toBe('timeout')
    expect(
      transportError({ signal: new AbortController().signal }, 'GET', new Error('x'), messages)
        .code,
    ).toBe('unavailable')
  })
  it('send passes method/headers/body/signal', async () => {
    const { ctx, calls } = fakeContext([{ ok: true }])
    await send(ctx, 'https://x/v1', { method: 'POST', headers: { a: 'b' }, body: '{}' }, messages)
    expect(calls()[0]).toMatchObject({
      url: 'https://x/v1',
      method: 'POST',
      headers: { a: 'b' },
      body: {},
    })
  })
  it('send refuses an aborted signal and maps a thrown fetch', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const a = fakeContext([{ ok: true }], { signal: aborted.signal })
    await expect(send(a.ctx, 'https://x', { method: 'GET' }, messages)).rejects.toMatchObject({
      code: 'cancelled',
    })
    const b = fakeContext([new Error('offline')])
    await expect(send(b.ctx, 'https://x', { method: 'POST' }, messages)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
  it('readText / readJson', async () => {
    const ctx = fakeContext().ctx
    expect(await readJson(ctx, new Response('{"a":1}'), 'GET', messages)).toEqual({ a: 1 })
    expect(await readJson(ctx, new Response('bad'), 'GET', messages)).toBeNull()
    expect(await readText(ctx, new Response('plain'), 'GET', messages)).toBe('plain')
    await expect(
      readText(
        ctx,
        { text: () => Promise.reject(new Error('x')) } as unknown as Response,
        'GET',
        messages,
      ),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('apiKey / baseUrl / errorCode', () => {
  it('apiKey throws auth when missing', () => {
    expect(() => apiKey(fakeContext([], { secrets: {} }).ctx)).toThrow(ProviderError)
  })
  it('baseUrl cn / global / override', () => {
    expect(baseUrl(fakeContext().ctx)).toBe(CN_BASE_URL)
    expect(
      baseUrl(fakeContext([], { secrets: { MINIMAX_API_KEY: 'k', MINIMAX_REGION: 'global' } }).ctx),
    ).toBe(GLOBAL_BASE_URL)
    expect(
      baseUrl(
        fakeContext([], { secrets: { MINIMAX_API_KEY: 'k', MINIMAX_BASE_URL: 'https://proxy' } })
          .ctx,
      ),
    ).toBe('https://proxy')
  })
  it('maps MiniMax codes', () => {
    const cases: Array<[string | number, ProviderErrorCode]> = [
      [410, 'unavailable'],
      [401, 'auth'],
      [1004, 'auth'],
      [1008, 'quota'],
      [1002, 'rate_limit'],
      [1026, 'content_policy'],
      [1001, 'timeout'],
      [1000, 'unavailable'],
      [2013, 'invalid_input'],
      ['auth_failed', 'auth'],
      ['weird', 'unknown'],
    ]
    for (const [code, expected] of cases) expect(errorCode(code)).toBe(expected)
  })
})

describe('requestJson (recorded fixtures)', () => {
  it('builds the recorded chat request and parses base_resp success', async () => {
    const f = fixture('chat-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const data = await requestJson(ctx, '/v1/chat/completions', f.request.body)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.method).toBe('POST')
    expect(calls()[0]?.headers).toMatchObject({
      Authorization: 'Bearer <redacted>',
      'Content-Type': 'application/json',
    })
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(data).toEqual(f.response.body)
  })
  it('omits Content-Type for FormData uploads', async () => {
    const { ctx, calls } = fakeContext([{ base_resp: { status_code: 0 }, file: { file_id: 1 } }])
    const form = new FormData()
    form.set('purpose', 'voice_clone')
    await requestJson(ctx, '/v1/files/upload', form)
    expect(calls()[0]?.rawBody).toBeInstanceOf(FormData)
    expect(calls()[0]?.headers?.['Content-Type']).toBeUndefined()
  })
  it('maps business errors in a 200 body', async () => {
    const f = fixture('business-error')
    const { ctx } = fakeContext([fixtureReply(f)])
    await expect(requestJson(ctx, '/v1/models')).rejects.toMatchObject({ code: 'auth' })
  })
  it('maps HTTP errors with GET retry semantics', async () => {
    const f = fixture('http-error')
    const { ctx } = fakeContext([fixtureReply(f)])
    await expect(requestJson(ctx, '/v1/models')).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
    })
  })
  it('rejects invalid JSON / array responses', async () => {
    const a = fakeContext([new Response('not-json')])
    await expect(requestJson(a.ctx, '/x')).rejects.toMatchObject({ code: 'unknown' })
    const b = fakeContext([new Response('[1,2]')])
    await expect(requestJson(b.ctx, '/x')).rejects.toMatchObject({ code: 'unknown' })
  })
  it('builds a query string for list endpoints', async () => {
    const f = fixture('list-tasks')
    const { ctx, calls } = fakeContext([f.response.body])
    await requestJson(ctx, '/v2/query/video_generation', undefined, {
      method: 'GET',
      query: { page_num: 1, page_size: 20, 'filter.status': undefined },
    })
    expect(calls()[0]?.url).toBe(f.request.url)
  })
})
