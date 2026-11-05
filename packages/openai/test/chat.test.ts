import { describe, expect, it } from 'vite-plus/test'
import { terminalResponse, imageDataUrl, responsesChat, compatibleChat } from '../src/chat'
import type { TransportMessages } from '../src/http'
import { fakeContext } from './helpers'

const transport: TransportMessages = {
  cancelled: 'OpenAI 请求已取消；生成提交可能已受理',
  network: 'OpenAI 网络请求失败；生成提交结果未知，请勿直接重提',
}

function sse(frames: unknown[]): Response {
  return new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const responseFrames = (terminal = true) => [
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
  ...(terminal
    ? [
        {
          type: 'response.completed',
          response: {
            id: 'r1',
            created_at: 1,
            model: 'gpt-6.1-sol',
            status: 'completed',
            output: [],
            usage: { input_tokens: 3, output_tokens: 1 },
          },
        },
      ]
    : []),
]

const input = { messages: [{ role: 'user' as const, content: 'hello' }], temperature: 0.7 }

describe('responsesChat：官方渠道 /responses', () => {
  it('无状态请求带加密思考；temperature:false 时不发温度', async () => {
    const { ctx, fetch, body } = fakeContext([sse(responseFrames())], {
      secret: { OPENAI_API_KEY: 'sk-k' },
    })
    const result = await responsesChat({
      ctx,
      model: 'gpt-6.1-sol',
      apiKey: 'sk-k',
      label: 'OpenAI',
      input,
      messages: transport,
      temperatureDisabled: true,
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ type: 'text', text: 'hi' }],
      usage: { inputTokens: 3, outputTokens: 1 },
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses')
    expect(body()).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] })
    expect(body()).not.toHaveProperty('temperature')
  })

  it('声明允许温度时照常发送', async () => {
    const { ctx, body } = fakeContext([sse(responseFrames())])
    await responsesChat({
      ctx,
      model: 'm',
      apiKey: 'k',
      label: 'OpenAI',
      input,
      messages: transport,
    })
    expect(body().temperature).toBe(0.7)
  })

  it('没有结束事件的流保留 outcome: unknown', async () => {
    const { ctx } = fakeContext([sse(responseFrames(false))])
    await expect(
      responsesChat({ ctx, model: 'm', apiKey: 'k', label: 'OpenAI', input, messages: transport }),
    ).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
  })

  it('拒绝模型声明之外的思考强度', async () => {
    const { ctx, fetch } = fakeContext()
    await expect(
      responsesChat({
        ctx,
        model: 'gpt-6.1-sol',
        apiKey: 'k',
        label: 'OpenAI',
        input: { ...input, extra: { reasoning_effort: 'x' } },
        messages: transport,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('HTTP 错误归类并脱敏密钥', async () => {
    const { ctx } = fakeContext([
      Response.json(
        { error: { code: 'insufficient_quota', message: 'bad sk-secret' } },
        { status: 429 },
      ),
    ])
    await expect(
      responsesChat({
        ctx,
        model: 'm',
        apiKey: 'sk-secret',
        label: 'OpenAI',
        input,
        messages: transport,
      }),
    ).rejects.toMatchObject({ code: 'quota', message: 'bad [redacted]' })
  })
})

describe('compatibleChat：兼容渠道 Chat Completions', () => {
  const frame = (end = true) =>
    new Response(
      `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n${end ? 'data: [DONE]\n\n' : ''}`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )

  it('流式请求发到 baseURL，带 [DONE] 才算完整', async () => {
    const { ctx, fetch, body } = fakeContext([frame()])
    const result = await compatibleChat({
      ctx,
      baseURL: 'https://gw.example.com/v1',
      model: 'custom',
      apiKey: 'k',
      label: '兼容渠道',
      input,
      messages: transport,
    })
    expect(result).toMatchObject({ state: 'succeeded', outputs: [{ type: 'text', text: 'ok' }] })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://gw.example.com/v1/chat/completions')
    expect(body()).toMatchObject({ model: 'custom', stream: true })
  })

  it('缺少 [DONE] 保留 outcome: unknown', async () => {
    const { ctx } = fakeContext([frame(false)])
    await expect(
      compatibleChat({
        ctx,
        baseURL: 'https://gw.example.com/v1',
        model: 'custom',
        apiKey: 'k',
        label: '兼容渠道',
        input,
        messages: transport,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' })
  })

  it('401 归为 auth，Bearer 令牌脱敏', async () => {
    const { ctx } = fakeContext([
      Response.json({ error: { message: 'k Bearer sk-private' } }, { status: 401 }),
    ])
    await expect(
      compatibleChat({
        ctx,
        baseURL: 'https://gw.example.com/v1',
        model: 'custom',
        apiKey: 'k',
        label: '兼容渠道',
        input,
        messages: transport,
      }),
    ).rejects.toMatchObject({ code: 'auth', message: '[redacted] Bearer [redacted]' })
  })
})

describe('imageDataUrl 与 terminalResponse', () => {
  it('优先读 ctx.files，回退 assets，都没有则报错', async () => {
    const ref = { assetId: 'a1', kind: 'image' as const }
    const { ctx } = fakeContext([], {
      assets: { load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }) },
    })
    expect(await imageDataUrl(ctx, ref, 'OpenAI')).toBe('data:image/png;base64,AQID')
    const viaFiles = {
      ...ctx,
      files: { read: async () => ({ data: new Uint8Array([1]), mime: 'image/webp' }) },
    }
    expect(await imageDataUrl(viaFiles, ref, 'OpenAI')).toBe('data:image/webp;base64,AQ==')
    await expect(imageDataUrl(fakeContext().ctx, ref, 'OpenAI')).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('拒绝非图片 / 不支持的类型 / 超限', async () => {
    const { ctx } = fakeContext([], {
      assets: { load: async () => ({ data: new Uint8Array([1]), mime: 'image/gif' }) },
    })
    await expect(imageDataUrl(ctx, { assetId: 'a', kind: 'video' }, 'OpenAI')).rejects.toThrow(
      /只接受图片/,
    )
    await expect(imageDataUrl(ctx, { assetId: 'a', kind: 'image' }, 'OpenAI')).rejects.toThrow(
      /PNG、JPEG 或 WebP/,
    )
  })

  it('非事件流响应原样返回', () => {
    const res = Response.json({})
    expect(terminalResponse(res)).toBe(res)
  })
})

describe('当前模型与 Responses 原生参数', () => {
  it.each([
    ['gpt-6.1-sol', 'max'],
    ['gpt-6-astra', 'xhigh'],
    ['gpt-6.1-terra', 'none'],
    ['gpt-6-luna', 'max'],
  ])('%s 的 %s 发到 reasoning.effort', async (model, effort) => {
    const { ctx, body } = fakeContext([sse(responseFrames())])
    await responsesChat({
      ctx,
      model,
      apiKey: 'k',
      label: 'OpenAI',
      messages: transport,
      input: { ...input, extra: { reasoning_effort: effort } },
    })
    expect(body().reasoning).toMatchObject({ effort })
    expect(body()).not.toHaveProperty('reasoning_effort')
  })

  it('原生参数保留，归一化模型、消息、工具与结构化输出不能被 extra 覆盖', async () => {
    const { ctx, body } = fakeContext([sse(responseFrames())])
    await responsesChat({
      ctx,
      model: 'gpt-6.1-sol',
      apiKey: 'k',
      label: 'OpenAI',
      messages: transport,
      temperatureDisabled: true,
      input: {
        ...input,
        extra: {
          reasoning: { effort: 'max', mode: 'pro', context: 'all_turns' },
          text: { verbosity: 'low' },
          service_tier: 'fast',
          parallel_tool_calls: false,
          prompt_cache_options: { ttl: '12h' },
          safety_identifier: 'hashed-user',
          metadata: { task: 'test' },
          include: ['message.output_text.logprobs'],
          model: 'wrong',
          input: 'wrong',
          stream: false,
          tools: [{ type: 'web_search' }],
          temperature: 1,
          max_output_tokens: 1,
        },
      },
    })
    expect(body()).toMatchObject({
      model: 'gpt-6.1-sol',
      stream: true,
      reasoning: { effort: 'max', mode: 'pro', context: 'all_turns' },
      text: { verbosity: 'low' },
      service_tier: 'fast',
      parallel_tool_calls: false,
      prompt_cache_options: { ttl: '12h' },
      safety_identifier: 'hashed-user',
      metadata: { task: 'test' },
    })
    expect(body().include).toEqual(
      expect.arrayContaining(['reasoning.encrypted_content', 'message.output_text.logprobs']),
    )
    expect(body().input).not.toBe('wrong')
    expect(body()).not.toHaveProperty('temperature')
    expect(body()).not.toHaveProperty('max_output_tokens')
    expect(body()).not.toHaveProperty('tools')
  })

  it('显式存储和 previous_response_id 可用', async () => {
    const { ctx, body } = fakeContext([sse(responseFrames())])
    await responsesChat({
      ctx,
      model: 'gpt-6.1-sol',
      apiKey: 'k',
      label: 'OpenAI',
      messages: transport,
      input: { ...input, extra: { store: true, previous_response_id: 'resp_prior' } },
    })
    expect(body()).toMatchObject({ store: true, previous_response_id: 'resp_prior' })
  })

  it.each([
    { reasoning_effort: 'none' },
    { reasoning: { effort: 'none' } },
    { service_tier: 'invalid' },
    { background: true },
    { prompt_cache_options: { prewarm: true } },
    { conversation: 'conv_1', previous_response_id: 'resp_1' },
  ])('无效组合在发送前拒绝 %j', async (extra) => {
    const { ctx, fetch } = fakeContext()
    await expect(
      responsesChat({
        ctx,
        model: 'gpt-6.1-sol',
        apiKey: 'k',
        label: 'OpenAI',
        messages: transport,
        input: { ...input, extra },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
