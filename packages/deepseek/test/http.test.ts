import { createAdapterContext, ProviderError } from '@modelbay/core'
import { describe, expect, it, vi } from 'vite-plus/test'
import { apiKey, baseUrl, requestJson, sendRequest, readJsonResponse, errorInfo } from '../src/http'

const context = (fetchImpl: typeof fetch, secrets = { DEEPSEEK_API_KEY: 'secret-test' }) =>
  createAdapterContext({ fetchImpl, secrets })

describe('DeepSeek transport', () => {
  it('uses configured origin, strips /v1, and preserves multipart boundaries', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer secret-test' })
      expect(init?.body).toBeInstanceOf(FormData)
      expect(init?.redirect).toBe('error')
      return Response.json({ ok: true })
    })
    const ctx = createAdapterContext({
      secrets: {
        DEEPSEEK_API_KEY: 'secret-test',
        DEEPSEEK_BASE_URL: 'https://gateway.example/v1/',
      },
      fetchImpl: fetcher as typeof fetch,
    })
    await sendRequest(ctx, '/v1/tools/asr', 'POST', new FormData())
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/tools/asr')
  })
  it('sends JSON and decodes responses', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'x' })
      return Response.json({ results: [] })
    })
    expect(
      await requestJson(context(fetcher as typeof fetch), '/v1/tools/search', 'POST', {
        query: 'x',
      }),
    ).toEqual({ results: [] })
  })
  it.each([
    [401, 'auth'],
    [402, 'quota'],
    [429, 'rate_limit'],
    [504, 'timeout'],
    [503, 'unavailable'],
    [422, 'invalid_input'],
  ])('maps HTTP %s without leaking keys or retrying POST', async (status, code) => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { message: 'bad secret-test Bearer token', code: 'upstream' } },
        { status: Number(status) },
      ),
    )
    await expect(
      requestJson(context(fetcher as typeof fetch), '/responses', 'POST', {}),
    ).rejects.toMatchObject({ code, retryable: false })
    try {
      await requestJson(context(fetcher as typeof fetch), '/responses', 'POST', {})
    } catch (error) {
      expect(String(error)).not.toContain('secret-test')
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('marks network or malformed POST replies unknown, but GET retryable', async () => {
    const ctx = context((async () => {
      throw new Error('offline')
    }) as typeof fetch)
    await expect(requestJson(ctx, '/responses', 'POST', {})).rejects.toMatchObject({
      outcome: 'unknown',
      retryable: false,
    })
    await expect(requestJson(ctx, '/models', 'GET')).rejects.toMatchObject({ retryable: true })
    await expect(readJsonResponse(ctx, new Response('bad'))).rejects.toMatchObject({
      outcome: 'unknown',
    })
    await expect(
      readJsonResponse(ctx, Response.json({ error: { message: 'bad' } })),
    ).rejects.toBeInstanceOf(ProviderError)
  })
  it('rejects missing keys, invalid base URLs and foreign paths before sending', async () => {
    const fetcher = vi.fn(async () => Response.json({}))
    const ctx = context(fetcher as typeof fetch)
    expect(() => apiKey(createAdapterContext())).toThrow('DEEPSEEK_API_KEY')
    for (const value of ['xxx', 'file:///tmp/a', 'https://u:p@host', 'https://host/?a=1'])
      expect(() =>
        baseUrl(createAdapterContext({ secrets: { DEEPSEEK_BASE_URL: value } })),
      ).toThrow()
    for (const path of ['https://evil.test', '//evil.test', '/a/../x', '/a\\x'])
      await expect(sendRequest(ctx, path, 'POST')).rejects.toMatchObject({ code: 'invalid_input' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      sendRequest(createAdapterContext({ signal: controller.signal }), '/models', 'GET'),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(errorInfo({ error: { code: 'content_filter' } }, 200, ctx).code).toBe('content_policy')
    expect(
      JSON.stringify(
        errorInfo({ error: { code: 'secret-test', message: 'Content Exists Risk' } }, 400, ctx)
          .cause,
      ),
    ).not.toContain('secret-test')
    expect(errorInfo({ error: { message: 'Content Exists Risk' } }, 400, ctx).code).toBe(
      'content_policy',
    )
  })
})
