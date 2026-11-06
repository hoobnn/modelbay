/**
 * 方舟 Responses API 对话：联网搜索（web_search）、previous_response_id、max_tool_calls。
 * 注入 fetch 断言请求路径和请求体，应答形状取自官方文档示例。
 */
import { describe, expect, it } from 'vite-plus/test'
import { arkAdapter, arkPlanAdapter } from '../src/index'
import { fakeContext } from './helpers'

const PRO = 'ark:doubao-seed-2-1-pro-260915'
const user = [{ role: 'user' as const, content: '今天有什么 AI 热点' }]
const chat = (model: string, input: Record<string, unknown>) =>
  ({ capability: 'text.chat', model, input }) as never

const completed = (overrides: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  error: null,
  incomplete_details: null,
  output: [
    { id: 'rs_1', type: 'reasoning', status: 'completed', summary: [] },
    {
      id: 'ws_1',
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', query: 'AI 热点', queries: ['AI 热点'] },
    },
    {
      id: 'msg_1',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '热点是 X。',
          annotations: [{ type: 'url_citation', title: '标题', url: 'https://example.com/a' }],
        },
      ],
    },
  ],
  usage: { input_tokens: 30, output_tokens: 12, tool_usage: { web_search: 1 } },
  ...overrides,
})

describe('Responses 对话', () => {
  it('web_search 与 previous_response_id 走 /responses，字段进请求体，结果带 response_id 和引用', async () => {
    const { ctx, fetch, body } = fakeContext([completed()])
    const deltas: string[] = []
    ctx.stream = (delta) => deltas.push(delta.text)
    const result = await arkAdapter.submit(
      chat(PRO, {
        messages: user,
        temperature: 0.3,
        maxTokens: 256,
        extra: {
          web_search: { limit: 5, max_keyword: 2, sources: ['toutiao', 'search_engine'] },
          previous_response_id: 'resp_0',
          max_tool_calls: 4,
          thinking: { type: 'disabled' },
        },
      }),
      ctx,
    )
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/responses',
    )
    const request = body()
    expect(request).toEqual({
      model: 'doubao-seed-2-1-pro-260915',
      input: [{ role: 'user', content: '今天有什么 AI 热点' }],
      tools: [
        { type: 'web_search', limit: 5, max_keyword: 2, sources: ['toutiao', 'search_engine'] },
      ],
      previous_response_id: 'resp_0',
      max_tool_calls: 4,
      thinking: { type: 'disabled' },
      temperature: 0.3,
      max_output_tokens: 256,
    })
    expect(request).not.toHaveProperty('stream')
    expect(result).toEqual({
      state: 'succeeded',
      outputs: [
        { type: 'text', text: '热点是 X。' },
        {
          type: 'json',
          value: {
            response_id: 'resp_1',
            status: 'completed',
            citations: [{ type: 'url_citation', title: '标题', url: 'https://example.com/a' }],
            web_searches: [{ status: 'completed', query: 'AI 热点', queries: ['AI 热点'] }],
            tool_usage: { web_search: 1 },
          },
        },
      ],
      usage: { inputTokens: 30, outputTokens: 12 },
    })
    expect(deltas).toEqual(['热点是 X。'])
  })

  it('web_search: true 等价于空对象；system 与图片按官方 input 结构', async () => {
    const { ctx, body } = fakeContext([completed()], {
      assets: {
        load: async () => ({ data: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' }),
      },
    })
    await arkAdapter.submit(
      chat(PRO, {
        messages: [
          { role: 'system', content: '简短回答' },
          { role: 'assistant', content: '好的' },
          {
            role: 'user',
            content: [
              { type: 'text', text: '图里是什么' },
              { type: 'image', image: { assetId: 'a1', kind: 'image', mime: 'image/png' } },
            ],
          },
        ],
        extra: { web_search: true },
      }),
      ctx,
    )
    const request = body()
    expect(request.tools).toEqual([{ type: 'web_search' }])
    const input = request.input as Array<Record<string, unknown>>
    expect(input[0]).toEqual({ role: 'system', content: '简短回答' })
    expect(input[1]).toEqual({ role: 'assistant', content: '好的' })
    const parts = input[2]!.content as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({ type: 'input_text', text: '图里是什么' })
    expect(parts[1]).toMatchObject({ type: 'input_image' })
    expect(String(parts[1]!.image_url)).toMatch(/^data:image\/png;base64,/)
  })

  it('只传 previous_response_id 也走 /responses，不带 tools', async () => {
    const { ctx, fetch, body } = fakeContext([completed()])
    await arkAdapter.submit(
      chat(PRO, { messages: user, extra: { previous_response_id: 'r0' } }),
      ctx,
    )
    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/responses$/)
    expect(body()).not.toHaveProperty('tools')
    expect(body().previous_response_id).toBe('r0')
  })

  it('不带这些字段的对话仍走流式 /chat/completions', async () => {
    const { ctx, fetch, body } = fakeContext([
      new Response(
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}]}\n\n' +
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ])
    await arkAdapter.submit(chat(PRO, { messages: user, extra: { top_p: 0.5 } }), ctx)
    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/chat\/completions$/)
    expect(body().stream).toBe(true)
  })

  it('取值按声明校验：超出范围、doubao 与其他来源混用都在联网前报错', async () => {
    const bad: Array<Record<string, unknown>> = [
      { web_search: { limit: 51 } },
      { web_search: { sources: ['bing'] } },
      { web_search: { sources: ['doubao', 'toutiao'] } },
      { web_search: { user_location: { city: '北京' } } },
      { max_tool_calls: 11 },
      { previous_response_id: 1 },
      { web_search: {}, frequency_penalty: 0.1 },
      { web_search: {}, model: 'hacked' },
    ]
    for (const extra of bad) {
      const { ctx, fetch } = fakeContext([])
      await expect(
        arkAdapter.submit(chat(PRO, { messages: user, extra }), ctx),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('没有声明这些字段的模型、自定义 Endpoint、套餐渠道都拒绝', async () => {
    const extra = { web_search: {} }
    for (const [adapter, model] of [
      [arkAdapter, 'ark:custom-chat'],
      [arkAdapter, 'ark:ep-20260101-abc'],
      [arkPlanAdapter, 'ark-plan:doubao-seed-evolving'],
      [arkPlanAdapter, 'ark-plan:doubao-seed-2.1-pro'],
    ] as const) {
      const { ctx, fetch } = fakeContext([], { secret: 'k' })
      await expect(
        adapter.submit(chat(model, { messages: user, extra }), ctx),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('工具调用和结构化输出在这条路上明确报错而不是丢弃', async () => {
    for (const input of [
      { tools: [{ name: 'f', description: 'd', parameters: { type: 'object' } }] },
      { jsonSchema: { type: 'object' } },
      { messages: [{ role: 'tool', content: 'x', toolCallId: '1', toolName: 'f' }] },
    ]) {
      const { ctx, fetch } = fakeContext([])
      await expect(
        arkAdapter.submit(chat(PRO, { messages: user, ...input, extra: { web_search: {} } }), ctx),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('错误与内容过滤：HTTP 错误归类，内容过滤是 content_policy，空回答报 unknown', async () => {
    const extra = { web_search: {} }
    const run = (reply: unknown) =>
      arkAdapter.submit(chat(PRO, { messages: user, extra }), fakeContext([reply]).ctx)
    await expect(
      run(
        Response.json({ error: { code: 'RateLimitExceeded', message: 'slow' } }, { status: 429 }),
      ),
    ).rejects.toMatchObject({ code: 'rate_limit' })
    await expect(
      run(
        completed({
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter', content_filter: { details: 'x' } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'content_policy' })
    await expect(run(completed({ output: [] }))).rejects.toMatchObject({ code: 'unknown' })
  })

  it('达到输出上限的 incomplete 响应返回已有文本并标出原因', async () => {
    const { ctx } = fakeContext([
      completed({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    ])
    const result = await arkAdapter.submit(
      chat(PRO, { messages: user, extra: { web_search: {} } }),
      ctx,
    )
    expect(result).toMatchObject({
      outputs: [
        { type: 'text' },
        { type: 'json', value: { status: 'incomplete', incomplete_reason: 'max_output_tokens' } },
      ],
    })
  })
})
