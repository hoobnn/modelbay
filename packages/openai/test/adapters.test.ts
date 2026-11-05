import { describe, expect, it } from 'vite-plus/test'
import type { AdapterRequest } from '@modelbay/core'
import {
  channels,
  createOpenAIAdapter,
  models,
  openaiAdapter,
  openaiCompatibleAdapter,
} from '../src/index'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

function sse(frames: unknown[], done = false): Response {
  const text =
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Responses API 的最小成功流。 */
function responsesStream(): Response {
  return sse([
    { type: 'response.created', response: { id: 'r1', created_at: 1, model: 'gpt-6.1-sol' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: 'm1', type: 'message', role: 'assistant', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: 'm1',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    {
      type: 'response.output_text.delta',
      item_id: 'm1',
      output_index: 0,
      content_index: 0,
      delta: 'hi',
    },
    {
      type: 'response.completed',
      response: {
        id: 'r1',
        created_at: 1,
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [],
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    },
  ])
}

/** Chat Completions 流式应答，以 [DONE] 结束。 */
function chatStream(): Response {
  return sse([{ id: 'c1', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }], true)
}

function request(
  capability: AdapterRequest['capability'],
  model = 'openai:gpt-6.1-sol',
): AdapterRequest {
  return {
    capability,
    model,
    input: { messages: [{ role: 'user', content: 'Hello' }] },
  }
}

describe('适配器导出', () => {
  it('两个适配器、channels、models 都按契约导出', () => {
    expect(openaiAdapter.id).toBe('openai/api')
    expect(openaiAdapter.channels).toEqual(['openai'])
    expect(openaiCompatibleAdapter.id).toBe('openai/compatible')
    expect(openaiCompatibleAdapter.channels).toEqual(['openai-compatible'])
    expect(channels).toEqual(['openai', 'openai-compatible'])
    expect(Array.isArray(models)).toBe(true)
    expect(openaiAdapter.nativeOperations).toContain('listModels')
    expect(openaiAdapter.nodeOnly).toContain('node')
  })
})

describe('openaiAdapter.submit：官方数据面', () => {
  it('文本对话走 /v1/responses（流式）并解析响应', async () => {
    const { ctx, fetch } = fakeContext([responsesStream()], {
      secret: { OPENAI_API_KEY: 'sk-recorded-key' },
    })
    const result = await openaiAdapter.submit(request('text.chat'), ctx)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer sk-recorded-key')
    expect(result).toMatchObject({ state: 'succeeded', outputs: [{ type: 'text', text: 'hi' }] })
  })

  it('图片生成走 /v1/images/generations', async () => {
    const recorded = fixture<RecordedCall>('image-success')
    const { ctx, fetch } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { OPENAI_API_KEY: 'k' },
    })
    const result = await openaiAdapter.submit(
      {
        capability: 'image.generate',
        model: 'openai:gpt-image-2.5-sunburst',
        input: { prompt: '一只猫' },
      },
      ctx,
    )
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    expect(result.state).toBe('succeeded')
  })

  it('图片编辑走 /v1/images/edits 并传 images / mask', async () => {
    const adapter = createOpenAIAdapter(models, {
      editMask: async (_ctx, { source, mask }) => ({
        original: { ...source, mime: 'image/png' },
        mask: { ...mask, mime: 'image/png' },
        width: 1,
        height: 1,
      }),
    })
    const { ctx, fetch } = fakeContext([{ data: [{ b64_json: 'iVBORw0KGgo=' }] }], {
      secret: { OPENAI_API_KEY: 'k' },
      assets: {
        load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }),
      },
    })
    await adapter.submit(
      {
        capability: 'image.edit',
        model: 'openai:gpt-image-2.5-sunburst',
        input: {
          image: { assetId: 'src', kind: 'image' },
          mask: { assetId: 'mask', kind: 'image' },
          prompt: '改天空',
        },
      },
      ctx,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    const body = JSON.parse(String(init?.body))
    expect(body.images).toHaveLength(1)
    expect(body.mask).toHaveProperty('image_url')
  })

  it('缺少 OPENAI_API_KEY 抛 auth，不支持的能力抛 invalid_input', async () => {
    const { ctx } = fakeContext([], { secret: {} })
    await expect(openaiAdapter.submit(request('text.chat'), ctx)).rejects.toMatchObject({
      code: 'auth',
    })
    const { ctx: ctx2 } = fakeContext([], { secret: { OPENAI_API_KEY: 'k' } })
    await expect(openaiAdapter.submit(request('audio.music'), ctx2)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('错误码 401 / 429 / 5xx 由适配器透传', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate_limit'],
      [500, 'unavailable'],
    ] as const) {
      const { ctx } = fakeContext([jsonResponse({ error: { message: '失败' } }, status)], {
        secret: { OPENAI_API_KEY: 'k' },
      })
      await expect(openaiAdapter.submit(request('text.chat'), ctx)).rejects.toMatchObject({
        code,
      })
    }
  })
})

describe('openaiCompatibleAdapter：兼容渠道', () => {
  const secrets = {
    OPENAI_COMPATIBLE_API_KEY: 'sk-recorded-key',
    OPENAI_COMPATIBLE_BASE_URL: 'https://llm.example.com/v1',
  }

  it('Base URL 来自 ctx.secret 配置，走流式 /chat/completions', async () => {
    const { ctx, fetch } = fakeContext([chatStream()], { secret: secrets })
    await openaiCompatibleAdapter.submit(
      request('text.chat', 'openai-compatible:my-custom-model'),
      ctx,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.example.com/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'my-custom-model', stream: true })
  })

  it('ctx.settings 优先：baseURL 与真实模型 ID 由宿主透传', async () => {
    const { ctx, fetch } = fakeContext([chatStream()], { secret: secrets })
    ctx.settings = { baseURL: 'https://settings.example.com/v1', model: 'real-model' }
    await openaiCompatibleAdapter.submit(
      request('text.chat', 'openai-compatible:identity-hash'),
      ctx,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://settings.example.com/v1/chat/completions')
    expect(JSON.parse(String(init?.body)).model).toBe('real-model')
  })

  it('input.extra.baseURL 优先于配置，且不会透传到上游', async () => {
    const { ctx, fetch } = fakeContext([chatStream()], { secret: secrets })
    await openaiCompatibleAdapter.submit(
      {
        capability: 'text.chat',
        model: 'openai-compatible:m',
        input: {
          messages: [{ role: 'user', content: 'hi' }],
          extra: { baseURL: 'https://other.example.com/v1' },
        },
      },
      ctx,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://other.example.com/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('baseURL')
  })

  it('缺 Base URL / 非法地址抛 invalid_input', async () => {
    const { ctx } = fakeContext([], {
      secret: { OPENAI_COMPATIBLE_API_KEY: 'k' },
    })
    await expect(
      openaiCompatibleAdapter.submit(request('text.chat', 'openai-compatible:m'), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const { ctx: ctx2 } = fakeContext([], {
      secret: {
        OPENAI_COMPATIBLE_API_KEY: 'k',
        OPENAI_COMPATIBLE_BASE_URL: 'http://bad.example.com',
      },
    })
    await expect(
      openaiCompatibleAdapter.submit(request('text.chat', 'openai-compatible:m'), ctx2),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('native / poll', () => {
  it('listModels 走 /models 并归一化条目', async () => {
    const recorded = fixture<RecordedCall>('model-list')
    const { ctx } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { OPENAI_API_KEY: 'k' },
    })
    const list = (await openaiAdapter.native?.('listModels', {}, ctx)) as unknown[]
    expect(list).toHaveLength(2)
  })

  it('未知 op 抛错；同步端点没有异步任务可轮询', async () => {
    const { ctx } = fakeContext([], { secret: { OPENAI_API_KEY: 'k' } })
    await expect(openaiAdapter.native?.('unknown', {}, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(openaiAdapter.poll?.('id-1', ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
