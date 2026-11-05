import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  asJson,
  defaultClassify,
  httpError,
  isJson,
  readJson,
  redactSecrets,
  request,
  retryableFor,
  send,
  transportError,
  withRetry,
  type TransportMessages,
} from '../src/http'
import { aborted, fakeContext, jsonResponse } from './helpers'

const messages: TransportMessages = {
  cancelled: '请求已取消',
  network: '网络请求失败；提交结果可能未知，不会自动重新提交',
  timeout: '请求超时',
}

function ctxFetch(replies: Parameters<typeof fakeContext>[0]) {
  return fakeContext(replies)
}

describe('asJson / isJson', () => {
  it('只把普通对象当作 Json', () => {
    expect(isJson({ a: 1 })).toBe(true)
    expect(isJson([1, 2])).toBe(false)
    expect(isJson(null)).toBe(false)
    expect(asJson('x')).toEqual({})
    expect(asJson({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('redactSecrets', () => {
  it('长密钥优先替换，Bearer 与 sk- 也脱敏', () => {
    const out = redactSecrets('Bearer sk-super-secret-123 与 sk-short 都出现', [
      'sk-super-secret-123',
      'sk-short',
    ])
    expect(out).toContain('[redacted]')
    expect(out).not.toContain('sk-super-secret-123')
    expect(out).not.toContain('sk-short')
  })
})

describe('retryableFor / withRetry', () => {
  it('GET 的 rate_limit / unavailable / timeout 可重试，POST 一律不可重试', () => {
    expect(retryableFor('GET', 'rate_limit')).toBe(true)
    expect(retryableFor('GET', 'unavailable')).toBe(true)
    expect(retryableFor('GET', 'timeout')).toBe(true)
    expect(retryableFor('GET', 'auth')).toBe(false)
    expect(retryableFor('POST', 'rate_limit')).toBe(false)
  })

  it('POST 的 5xx / 408 标记为结果未知，且不自动重试', () => {
    const error = new ProviderError('unavailable', '网关错误')
    const wrapped = withRetry(error, 'POST', 503)
    expect(wrapped.outcome).toBe('unknown')
    expect(wrapped.retryable).toBe(false)
    expect(withRetry(error, 'POST', 400).outcome).toBeUndefined()
  })

  it('GET 的限流保留 retryable', () => {
    const wrapped = withRetry(new ProviderError('rate_limit', '限流'), 'GET', 429)
    expect(wrapped.retryable).toBe(true)
  })
})

describe('defaultClassify', () => {
  it('把 HTTP 状态与关键字映射到归一化错误码', () => {
    expect(defaultClassify(401, 'unauthorized')).toBe('auth')
    expect(defaultClassify(403, 'forbidden')).toBe('auth')
    expect(defaultClassify(402, 'balance')).toBe('quota')
    expect(defaultClassify(429, 'ratelimit')).toBe('rate_limit')
    expect(defaultClassify(408, 'timeout')).toBe('timeout')
    expect(defaultClassify(504, 'gateway')).toBe('timeout')
    expect(defaultClassify(503, 'serveroverloaded')).toBe('unavailable')
    expect(defaultClassify(400, 'invalidparameter')).toBe('invalid_input')
    expect(defaultClassify(200, 'content_policy')).toBe('content_policy')
    expect(defaultClassify(200, 'nothing')).toBe('unknown')
  })
})

describe('httpError', () => {
  it('上游原始码/信息脱敏后放进 cause', () => {
    const error = httpError({
      label: '火山方舟',
      status: 429,
      body: { error: { code: 'RateLimit', message: 'key sk-secret-abc 触发限流' } },
      method: 'POST',
      secrets: ['sk-secret-abc'],
    })
    expect(error.code).toBe('rate_limit')
    expect(error.message).not.toContain('sk-secret-abc')
    expect(error.cause).toMatchObject({ status: 429, code: 'RateLimit' })
    expect(String((error.cause as { message: string }).message)).not.toContain('sk-secret-abc')
  })

  it('支持平台自定义分类', () => {
    const error = httpError({
      label: 'OpenAI',
      status: 400,
      body: { error: { code: 'insufficient_quota' } },
      method: 'POST',
      secrets: [],
      classify: (_status, code) => (code.includes('quota') ? 'quota' : undefined),
    })
    expect(error.code).toBe('quota')
  })
})

describe('transportError', () => {
  it('已中止的 signal 归为 cancelled', () => {
    const { ctx } = fakeContext([], { signal: aborted() })
    const error = transportError(ctx, 'GET', new Error('network'), messages)
    expect(error.code).toBe('cancelled')
  })

  it('TimeoutError 归为 timeout，POST 标结果未知', () => {
    const { ctx } = fakeContext()
    const timeout = new Error('slow')
    timeout.name = 'TimeoutError'
    const error = transportError(ctx, 'POST', timeout, messages)
    expect(error.code).toBe('timeout')
    expect(error.outcome).toBe('unknown')
  })

  it('普通网络失败归为 unavailable，GET 可重试', () => {
    const { ctx } = fakeContext()
    const error = transportError(ctx, 'GET', new Error('offline'), messages)
    expect(error.code).toBe('unavailable')
    expect(error.retryable).toBe(true)
  })
})

describe('send / readJson', () => {
  it('尚未发出请求就中止时直接抛 cancelled', async () => {
    const { ctx } = fakeContext([], { signal: aborted() })
    await expect(
      send(ctx, 'https://example.test/x', { method: 'GET' }, messages),
    ).rejects.toMatchObject({
      code: 'cancelled',
    })
  })

  it('透传 method / headers / body / signal 给宿主 fetch', async () => {
    const { ctx, fetch } = ctxFetch([{ ok: true }])
    await send(
      ctx,
      'https://example.test/x',
      { method: 'POST', headers: { 'X-Test': '1' }, body: '{"a":1}' },
      messages,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/x')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'X-Test': '1' })
    expect(init?.body).toBe('{"a":1}')
    expect(init?.signal).toBe(ctx.signal)
  })

  it('fetch 抛错时归类为传输失败', async () => {
    const { ctx } = fakeContext([new Error('offline')])
    await expect(
      send(ctx, 'https://example.test/x', { method: 'GET' }, messages),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('非 JSON 响应体返回 null', async () => {
    const { ctx } = fakeContext([new Response('not json')])
    expect(
      await readJson(ctx, await ctx.fetch('https://example.test/x'), 'GET', messages),
    ).toBeNull()
  })
})

describe('request', () => {
  it('成功响应返回解析后的对象', async () => {
    const { ctx } = ctxFetch([{ data: [1, 2] }])
    expect(
      await request({
        ctx,
        url: 'https://example.test/x',
        method: 'GET',
        headers: {},
        label: '测试',
        messages,
        secrets: [],
      }),
    ).toEqual({ data: [1, 2] })
  })

  it('GET 遇到 429 会重试并在恢复后成功', async () => {
    const { ctx, fetch } = ctxFetch([
      jsonResponse({ error: { code: 'rate_limit' } }, 429),
      { ok: true },
    ])
    const result = await request({
      ctx,
      url: 'https://example.test/x',
      method: 'GET',
      headers: {},
      label: '测试',
      messages,
      secrets: [],
      retries: 2,
      retryDelayMs: 0,
    })
    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('401 / 429 / 5xx 分别映射为 auth / rate_limit / unavailable', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate_limit'],
      [503, 'unavailable'],
    ] as const) {
      const { ctx } = ctxFetch([jsonResponse({ error: { message: '失败' } }, status)])
      await expect(
        request({
          ctx,
          url: 'https://example.test/x',
          method: 'POST',
          headers: {},
          body: '{}',
          label: '测试',
          messages,
          secrets: [],
          retries: 0,
        }),
      ).rejects.toMatchObject({ code })
    }
  })

  it('POST 提交失败不重试', async () => {
    const { ctx, fetch } = ctxFetch([
      jsonResponse({ error: { message: '限流' } }, 429),
      { ok: true },
    ])
    await expect(
      request({
        ctx,
        url: 'https://example.test/x',
        method: 'POST',
        headers: {},
        body: '{}',
        label: '测试',
        messages,
        secrets: [],
      }),
    ).rejects.toMatchObject({ code: 'rate_limit' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('toleratedStatuses 让业务失败状态交给轮询逻辑', async () => {
    const { ctx } = ctxFetch([
      { status: 'failed', error: { code: 'InternalError', message: '生成失败' } },
    ])
    const result = await request({
      ctx,
      url: 'https://example.test/x',
      method: 'GET',
      headers: {},
      label: '测试',
      messages,
      secrets: [],
      toleratedStatuses: ['failed'],
    })
    expect(result.status).toBe('failed')
  })

  it('成功但响应体不是 JSON 时抛 unknown', async () => {
    const { ctx } = ctxFetch([new Response('oops')])
    await expect(
      request({
        ctx,
        url: 'https://example.test/x',
        method: 'GET',
        headers: {},
        label: '测试',
        messages,
        secrets: [],
      }),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})
