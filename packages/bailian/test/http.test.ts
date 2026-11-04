import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  API_KEY_NAMES,
  apiKey,
  apiKeySecrets,
  asJson,
  baseUrl,
  DEFAULT_BASE_URL,
  isJson,
  readJson,
  readText,
  remoteError,
  requestJson,
  requestMessages,
  retryableFor,
  scrub,
  send,
  transportError,
  withRetry,
} from '../src/http'
import { fakeContext, fixture, fixtureReply, httpResponse } from './helpers'

describe('JSON helpers and redaction', () => {
  it('isJson / asJson', () => {
    expect(isJson({})).toBe(true)
    expect(isJson([])).toBe(false)
    expect(isJson(null)).toBe(false)
    expect(asJson(null)).toEqual({})
    expect(asJson({ a: 1 })).toEqual({ a: 1 })
  })

  it('scrub removes known secrets and generic tokens', () => {
    expect(scrub('key sk-abcdefgh is invalid', ['sk-abcdefgh'])).not.toContain('sk-abcdefgh')
    expect(scrub('Bearer sk-longtoken', [])).toBe('Bearer <redacted>')
  })
})

describe('retry rules', () => {
  it('GET can retry rate_limit / unavailable / timeout, POST never', () => {
    expect(retryableFor('GET', 'rate_limit')).toBe(true)
    expect(retryableFor('GET', 'unavailable')).toBe(true)
    expect(retryableFor('GET', 'timeout')).toBe(true)
    expect(retryableFor('GET', 'auth')).toBe(false)
    expect(retryableFor('POST', 'rate_limit')).toBe(false)
  })

  it('withRetry marks POST gateway failures as outcome unknown', () => {
    const error = new ProviderError('unavailable', 'gateway')
    expect(withRetry(error, 'POST', 503).outcome).toBe('unknown')
    expect(withRetry(error, 'GET', 503).outcome).toBeUndefined()
    expect(withRetry(error, 'POST', 400).outcome).toBeUndefined()
  })
})

describe('transportError', () => {
  const messages = { cancelled: 'cancelled', network: 'network', timeout: 'timeout' }
  it('abort -> cancelled with outcome unknown for POST', () => {
    const controller = new AbortController()
    controller.abort()
    const error = transportError({ signal: controller.signal }, 'POST', new Error('x'), messages)
    expect(error.code).toBe('cancelled')
    expect(error.outcome).toBe('unknown')
  })
  it('TimeoutError -> timeout when messages declare one', () => {
    const timeout = new Error('timeout')
    timeout.name = 'TimeoutError'
    const error = transportError({ signal: new AbortController().signal }, 'GET', timeout, messages)
    expect(error.code).toBe('timeout')
    expect(error.retryable).toBe(true)
  })
  it('plain network failure -> unavailable', () => {
    const error = transportError(
      { signal: new AbortController().signal },
      'GET',
      new Error('x'),
      messages,
    )
    expect(error.code).toBe('unavailable')
    expect(error.retryable).toBe(true)
  })
})

describe('send / readText / readJson', () => {
  const messages = { cancelled: 'cancelled', network: 'network' }
  it('send passes method, headers, body and signal', async () => {
    const { ctx, calls } = fakeContext([{ ok: true }])
    await send(
      ctx,
      'https://example.com/x',
      { method: 'POST', headers: { a: 'b' }, body: '{}' },
      messages,
    )
    expect(calls()[0]?.url).toBe('https://example.com/x')
    expect(calls()[0]?.method).toBe('POST')
    expect(calls()[0]?.headers).toEqual({ a: 'b' })
    expect(calls()[0]?.body).toEqual({})
  })
  it('send refuses an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const { ctx } = fakeContext([{ ok: true }], { signal: controller.signal })
    await expect(send(ctx, 'https://x', { method: 'GET' }, messages)).rejects.toMatchObject({
      code: 'cancelled',
    })
  })
  it('send maps a fetch throw to a ProviderError', async () => {
    const { ctx } = fakeContext([new Error('offline')])
    await expect(send(ctx, 'https://x', { method: 'POST' }, messages)).rejects.toMatchObject({
      code: 'unavailable',
      outcome: 'unknown',
    })
  })
  it('readText / readJson handle valid and invalid bodies', async () => {
    const ctx = fakeContext().ctx
    expect(await readJson(ctx, new Response('{"a":1}'), 'GET', messages)).toEqual({ a: 1 })
    expect(await readJson(ctx, new Response('not-json'), 'GET', messages)).toBeNull()
    expect(await readText(ctx, new Response('plain'), 'GET', messages)).toBe('plain')
    await expect(
      readText(
        ctx,
        { text: () => Promise.reject(new Error('boom')) } as unknown as Response,
        'GET',
        messages,
      ),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('apiKey / baseUrl / requestMessages', () => {
  it('apiKey throws auth when missing', () => {
    expect(() => apiKey(fakeContext([], { secrets: {} }).ctx)).toThrow(ProviderError)
    try {
      apiKey(fakeContext([], { secrets: { BAILIAN_API_KEY: '' } }).ctx)
      throw new Error('expected auth error')
    } catch (error) {
      expect(error).toMatchObject({ code: 'auth' })
    }
  })
  it('accepts the canonical BAILIAN_API_KEY and the DASHSCOPE_API_KEY alias', () => {
    expect(API_KEY_NAMES).toEqual(['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY'])
    expect(apiKey(fakeContext([], { secrets: { BAILIAN_API_KEY: 'canonical' } }).ctx)).toBe(
      'canonical',
    )
    expect(apiKey(fakeContext([], { secrets: { DASHSCOPE_API_KEY: 'alias' } }).ctx)).toBe('alias')
    expect(
      apiKey(
        fakeContext([], { secrets: { BAILIAN_API_KEY: 'first', DASHSCOPE_API_KEY: 'second' } }).ctx,
      ),
    ).toBe('first')
    expect(
      apiKeySecrets(
        fakeContext([], { secrets: { BAILIAN_API_KEY: 'a', DASHSCOPE_API_KEY: 'b' } }).ctx,
      ),
    ).toEqual(['a', 'b'])
  })
  it('baseUrl override (canonical and alias)', () => {
    expect(baseUrl(fakeContext().ctx)).toBe(DEFAULT_BASE_URL)
    expect(baseUrl(fakeContext([], { secrets: { BAILIAN_BASE_URL: 'https://intl' } }).ctx)).toBe(
      'https://intl',
    )
    expect(baseUrl(fakeContext([], { secrets: { DASHSCOPE_BASE_URL: 'https://alias' } }).ctx)).toBe(
      'https://alias',
    )
  })
  it('requestMessages differ for GET and POST', () => {
    expect(requestMessages('GET').network).not.toBe(requestMessages('POST').network)
  })
})

describe('remoteError mapping', () => {
  const ctx = fakeContext().ctx
  const cases: Array<[number, Record<string, unknown>, string]> = [
    [401, { error: { code: 'InvalidApiKey', message: 'bad' } }, 'auth'],
    [200, { code: 'Arrearage', message: 'no balance' }, 'quota'],
    [200, { code: 'ContentFilter', message: 'blocked' }, 'content_policy'],
    [429, { code: 'Throttling', message: 'slow down' }, 'rate_limit'],
    [408, { message: 'timeout' }, 'timeout'],
    [503, { message: 'down' }, 'unavailable'],
    [400, { code: 'InvalidParameter', message: 'bad' }, 'invalid_input'],
    [200, { message: 'weird' }, 'unknown'],
  ]
  it.each(cases)('maps %i %j to %s', (status, body, code) => {
    expect(remoteError(status, body, ctx).code).toBe(code)
  })
  it('keeps the raw upstream code/message in cause and scrubs secrets', () => {
    const error = remoteError(
      401,
      { error: { code: 'InvalidApiKey', message: 'key <redacted>' } },
      ctx,
    )
    expect(error.cause).toMatchObject({ status: 401, code: 'InvalidApiKey' })
    expect(error.message).not.toContain('sk-')
  })
})

describe('requestJson (recorded fixtures)', () => {
  it('constructs the recorded POST request and parses a success response', async () => {
    const f = fixture('chat-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const data = await requestJson(ctx, '/compatible-mode/v1/chat/completions', f.request.body)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.method).toBe('POST')
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(calls()[0]?.headers).toMatchObject({
      Authorization: 'Bearer <redacted>',
      'Content-Type': 'application/json',
    })
    expect(data).toEqual(f.response.body)
  })

  it('adds X-DashScope-Async and OssResourceResolve headers', async () => {
    const f = fixture('portrait')
    const { ctx, calls } = fakeContext([f.response.body])
    await requestJson(ctx, '/api/v1/services/aigc/image2video/video-synthesis', f.request.body, {
      asyncTask: true,
      oss: true,
    })
    expect(calls()[0]?.headers).toMatchObject({
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    })
  })

  it('maps HTTP errors with retry semantics', async () => {
    const f = fixture('http-error')
    const { ctx } = fakeContext([fixtureReply(f)])
    await expect(requestJson(ctx, '/api/v1/tasks/bad')).rejects.toMatchObject({
      code: 'auth',
      retryable: false,
    })
  })

  it('maps business errors embedded in a 200 body', async () => {
    const { ctx } = fakeContext([{ code: 'InvalidParameter', message: 'bad input' }])
    await expect(requestJson(ctx, '/x', {})).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects invalid JSON and empty responses', async () => {
    const a = fakeContext([new Response('not-json')])
    await expect(requestJson(a.ctx, '/x')).rejects.toMatchObject({ code: 'unknown' })
    const b = fakeContext([{}])
    await expect(requestJson(b.ctx, '/x')).rejects.toMatchObject({ code: 'unknown' })
  })

  it('GET is retryable on a 503', async () => {
    const { ctx } = fakeContext([httpResponse(503, { message: 'down' })])
    await expect(requestJson(ctx, '/api/v1/tasks/x')).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })
})
