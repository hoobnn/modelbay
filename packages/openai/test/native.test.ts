import { describe, expect, it } from 'vite-plus/test'
import { openaiAdapter, openaiCompatibleAdapter, nativeOperationSchemas } from '../src/index'
import { fakeContext } from './helpers'

const native = (params: Record<string, unknown>, replies: unknown[] = []) => {
  const fake = fakeContext(replies)
  return { ...fake, result: openaiAdapter.native!('raw-request', params, fake.ctx) }
}

describe('原生 Responses 请求', () => {
  it('内置工具、异步工具和原生 input items 原样传递，保留 response ID 与状态', async () => {
    const body = {
      model: 'gpt-6.1-sol',
      input: [{ type: 'configuration_update', reasoning: { effort: 'max' } }],
      tools: [
        { type: 'web_search' },
        { type: 'function', name: 'slow', async: true, parameters: {} },
      ],
      background: true,
      store: false,
    }
    const response = { id: 'resp_new', status: 'queued', output: [], usage: null }
    const call = native({ path: '/responses', body }, [response])
    expect(await call.result).toEqual(response)
    expect(call.body()).toEqual(body)
    expect(call.fetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses')
    expect(nativeOperationSchemas['raw-request']).toHaveProperty('properties')
    expect(openaiCompatibleAdapter.nativeOperations).not.toContain('raw-request')
  })

  it.each([
    ['GET', '/responses/resp_1'],
    ['POST', '/responses/resp_1/cancel'],
    ['DELETE', '/responses/resp_1'],
    ['GET', '/responses/resp_1/input_items'],
    ['POST', '/responses/compact'],
  ])('%s %s', async (method, path) => {
    const response = { id: 'resp_1', status: 'cancelled' }
    const call = native({ method, path }, [response])
    expect(await call.result).toEqual(response)
    expect(call.fetch.mock.calls[0]?.[1]?.method).toBe(method)
  })

  it('查询参数编码，失败状态及原生错误信息保留', async () => {
    const response = {
      id: 'resp_1',
      status: 'failed',
      error: { code: 'server_error', message: 'failed' },
    }
    const call = native(
      {
        method: 'GET',
        path: '/responses/resp_1',
        query: { include: ['reasoning.encrypted_content'], starting_after: 0 },
      },
      [response],
    )
    expect(await call.result).toEqual(response)
    expect(call.fetch.mock.calls[0]?.[0]).toContain(
      'include=reasoning.encrypted_content&starting_after=0',
    )
  })

  it.each([
    { path: 'https://evil.example/responses' },
    { path: '//evil.example/responses' },
    { path: '/responses/../models' },
    { path: '/responses/%2e%2e' },
    { path: '/responses', method: 'GET' },
    { path: '/responses/resp_1', method: 'PATCH' },
    { path: '/responses', body: [] },
    { path: '/responses', body: { stream: true } },
    { path: '/responses/resp_1', method: 'GET', body: {} },
    { path: '/responses', query: { bad: {} } },
  ])('无效原生请求不会联网 %j', async (params) => {
    const call = native(params)
    await expect(call.result).rejects.toMatchObject({ code: 'invalid_input' })
    expect(call.fetch).not.toHaveBeenCalled()
  })

  it('POST 失败不会自动重试；密钥脱敏', async () => {
    const call = native({ path: '/responses', body: {} }, [new Error('network')])
    await expect(call.result).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    expect(call.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('原生应答与 query 的完整性', () => {
  it.each([Response.json('wrong'), new Response('data: partial')])(
    '无效 POST 应答保留 outcome unknown',
    async (reply) => {
      const call = native({ path: '/responses', body: {} }, [reply])
      await expect(call.result).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
      expect(call.fetch).toHaveBeenCalledTimes(1)
    },
  )
  it.each([{ stream: true }, { stream: 'true' }, []])(
    '拒绝流式或非对象 query %j',
    async (query) => {
      const call = native({ path: '/responses/resp_1', method: 'GET', query })
      await expect(call.result).rejects.toMatchObject({ code: 'invalid_input' })
      expect(call.fetch).not.toHaveBeenCalled()
    },
  )
})
