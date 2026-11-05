import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  ACCESS_TOKEN_NAMES,
  API_KEY_NAMES,
  APP_ID_NAMES,
  asJson,
  events,
  failure,
  firstSecret,
  hasCredentials,
  readSecret,
  headers,
  HOST,
  incomplete,
  isJson,
  postJson,
  postText,
  scrub,
  send,
  transportError,
  retryableFor,
  withRetry,
  SECRET_NAMES,
} from '../src/http'
import { fakeContext, fixture, fixtureReply } from './helpers'

describe('helpers', () => {
  it('isJson / asJson / scrub', () => {
    expect(isJson({})).toBe(true)
    expect(isJson([])).toBe(false)
    expect(asJson(null)).toEqual({})
    expect(HOST).toBe('https://openspeech.bytedance.com')
    expect(SECRET_NAMES).toContain('DOUBAO_APP_ID')
    expect(SECRET_NAMES).toContain('DOUBAO_ACCESS_TOKEN')
    expect(SECRET_NAMES).toContain('VOLC_SPEECH_API_KEY')
    expect(scrub('Bearer sk-longsecret failed', fakeContext().ctx)).toBe('Bearer <redacted> failed')
  })
  it('retryableFor / withRetry', () => {
    expect(retryableFor('GET', 'rate_limit')).toBe(true)
    expect(retryableFor('POST', 'rate_limit')).toBe(false)
    expect(withRetry(new ProviderError('unavailable', 'x'), 'POST', 503).outcome).toBe('unknown')
  })
  it('transportError', () => {
    const aborted = new AbortController()
    aborted.abort()
    const messages = { cancelled: 'c', network: 'n', timeout: 't' }
    expect(transportError({ signal: aborted.signal }, 'POST', new Error('x'), messages).code).toBe(
      'cancelled',
    )
    const t = new Error('t')
    t.name = 'TimeoutError'
    expect(transportError({ signal: new AbortController().signal }, 'GET', t, messages).code).toBe(
      'timeout',
    )
    expect(
      transportError({ signal: new AbortController().signal }, 'GET', new Error('x'), messages)
        .code,
    ).toBe('unavailable')
  })
})

describe('headers', () => {
  it('uses the modern X-Api-Key', () => {
    const h = headers(fakeContext().ctx, 'seed-tts-2.0')
    expect(h).toMatchObject({
      'Content-Type': 'application/json',
      'X-Api-Key': '<redacted>',
      'X-Api-Resource-Id': 'seed-tts-2.0',
    })
    expect(h['X-Api-Request-Id']).toBeTruthy()
  })
  it('uses the canonical DOUBAO_API_KEY', () => {
    const { ctx } = fakeContext([], { secrets: { DOUBAO_API_KEY: 'modern' } })
    expect(headers(ctx)['X-Api-Key']).toBe('modern')
  })
  it('uses the canonical DOUBAO_APP_ID + DOUBAO_ACCESS_TOKEN pair', () => {
    const { ctx } = fakeContext([], {
      secrets: { DOUBAO_APP_ID: 'app', DOUBAO_ACCESS_TOKEN: 'token' },
    })
    expect(headers(ctx)).toMatchObject({ 'X-Api-App-Key': 'app', 'X-Api-Access-Key': 'token' })
  })
  it('accepts the upstream VOLC_SPEECH_* aliases', () => {
    const legacy = fakeContext([], {
      secrets: { VOLC_SPEECH_APP_ID: 'app', VOLC_SPEECH_ACCESS_KEY: 'access' },
    }).ctx
    expect(headers(legacy)).toMatchObject({ 'X-Api-App-Key': 'app', 'X-Api-Access-Key': 'access' })
    const tokenAlias = fakeContext([], {
      secrets: { VOLC_SPEECH_APP_ID: 'app', VOLC_SPEECH_ACCESS_TOKEN: 'token' },
    }).ctx
    expect(headers(tokenAlias)).toMatchObject({ 'X-Api-Access-Key': 'token' })
  })
  it('exposes the alias groups and credential checks', () => {
    expect(API_KEY_NAMES).toContain('DOUBAO_API_KEY')
    expect(APP_ID_NAMES).toContain('DOUBAO_APP_ID')
    expect(ACCESS_TOKEN_NAMES).toContain('DOUBAO_ACCESS_TOKEN')
    const none = fakeContext([], { secrets: {} }).ctx
    expect(hasCredentials(none)).toBe(false)
    expect(firstSecret(none, API_KEY_NAMES)).toBeUndefined()
    expect(
      hasCredentials(
        fakeContext([], { secrets: { DOUBAO_APP_ID: 'a', DOUBAO_ACCESS_TOKEN: 'b' } }).ctx,
      ),
    ).toBe(true)
    expect(hasCredentials(fakeContext([], { secrets: { DOUBAO_API_KEY: 'k' } }).ctx)).toBe(true)
  })
  it('throws auth when no credentials are configured', () => {
    const { ctx } = fakeContext([], { secrets: {} })
    expect(() => headers(ctx)).toThrow(ProviderError)
  })
})

describe('failure / incomplete', () => {
  const ctx = fakeContext().ctx
  it('maps status codes', () => {
    expect(failure(401, 1000, 'unauthorized', ctx).code).toBe('auth')
    expect(failure(402, 0, 'insufficient balance', ctx).code).toBe('quota')
    expect(failure(429, 0, 'rate limit', ctx).code).toBe('rate_limit')
    expect(failure(200, 45000001, 'bad input', ctx).code).toBe('invalid_input')
    expect(failure(200, 55000001, 'down', ctx).code).toBe('unavailable')
    expect(failure(200, 0, 'sensitive content', ctx).code).toBe('content_policy')
    expect(
      failure(200, 0, 'resource id is mismatched with speaker related resource', ctx).code,
    ).toBe('invalid_input')
  })
  it('keeps raw details in cause and scrubs secrets', () => {
    const error = failure(401, 1000, 'invalid key <redacted>', ctx)
    expect(error.cause).toMatchObject({ status: 401, code: 1000 })
    expect(error.message).not.toContain('sk-')
  })
  it('incomplete marks outcome unknown', () => {
    expect(incomplete('truncated').outcome).toBe('unknown')
  })
})

describe('events (chunked JSON)', () => {
  it('parses adjacent and newline-delimited JSON objects', () => {
    expect(events('{"a":1}{"a":2}')).toEqual([{ a: 1 }, { a: 2 }])
    expect(events('{"a":1}\n\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }])
  })
  it('rejects invalid or incomplete streams', () => {
    expect(() => events('nope')).toThrow(ProviderError)
    expect(() => events('{"a":')).toThrow(ProviderError)
    expect(() => events('')).toThrow(ProviderError)
  })
})

describe('postText / postJson (recorded fixtures)', () => {
  const messages = { cancelled: 'c', network: 'n' }
  it('send passes method/headers/body', async () => {
    const { ctx, calls } = fakeContext([{ ok: true }])
    await send(ctx, 'https://x', { method: 'POST', headers: { a: 'b' }, body: '{}' }, messages)
    expect(calls()[0]).toMatchObject({
      url: 'https://x',
      method: 'POST',
      headers: { a: 'b' },
      body: {},
    })
  })
  it('postText builds the recorded TTS request and returns raw text', async () => {
    const f = fixture('tts-success')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const raw = await postText(ctx, '/api/v3/tts/unidirectional', f.request.body ?? {}, {
      resource: 'seed-tts-2.0',
    })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(calls()[0]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Api-Key': '<redacted>',
      'X-Api-Resource-Id': 'seed-tts-2.0',
    })
    expect(raw).toBe(f.response.text)
  })
  it('postText adds X-Api-Sequence for ASR', async () => {
    const f = fixture('asr-flash')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await postText(ctx, '/api/v3/auc/bigmodel/recognize/flash', f.request.body ?? {}, {
      resource: 'volc.bigasr.auc_turbo',
      asr: true,
    })
    expect(calls()[0]?.headers).toMatchObject({ 'X-Api-Sequence': '-1' })
  })
  it('postText maps HTTP errors with the recorded fixture', async () => {
    const f = fixture('http-error')
    const { ctx } = fakeContext([fixtureReply(f)])
    await expect(postText(ctx, '/api/v3/tts/query', {})).rejects.toMatchObject({ code: 'auth' })
  })
  it('postText maps a non-success status header', async () => {
    const f = fixture('status-error')
    const { ctx } = fakeContext([fixtureReply(f)])
    await expect(postText(ctx, '/api/v3/tts/query', {})).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
  it('postJson parses a single JSON object', async () => {
    const f = fixture('translation')
    const { ctx } = fakeContext([fixtureReply(f)])
    const data = await postJson(
      ctx,
      '/api/v3/machine_translation/matx_translate',
      f.request.body ?? {},
      {
        resource: 'volc.speech.mt',
      },
    )
    expect(data).toEqual(f.response.body)
  })
  it('postJson rejects invalid JSON', async () => {
    const { ctx } = fakeContext([new Response('not-json')])
    await expect(postJson(ctx, '/x', {})).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('宿主对未声明密钥名抛错', () => {
  it('别名探测视为未配置，已声明的名字照常读取', () => {
    const { ctx } = fakeContext()
    ctx.secret = (name: string) => {
      if (name !== 'VOLC_SPEECH_API_KEY') throw new Error(`没有声明密钥 ${name}`)
      return 'k'
    }
    expect(readSecret(ctx, 'DOUBAO_API_KEY')).toBeUndefined()
    expect(firstSecret(ctx, API_KEY_NAMES)).toBe('k')
    expect(hasCredentials(ctx)).toBe(true)
    expect(scrub('key k', ctx)).toBe('key [redacted]')
  })
})
