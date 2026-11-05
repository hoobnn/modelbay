/**
 * 方舟对话：走 `@modelbay/shared` 的流式对话层（SSE），断言：
 * 请求体、`stream: true`、[DONE] 完整性、extra 白名单、套餐 continuation 累积与回传、自定义槽。
 */
import { describe, expect, it } from 'vite-plus/test'
import { arkAdapter, arkPlanAdapter } from '../src/index'
import { fakeContext, fixture, type RecordedCall } from './helpers'

const CHAT = 'ark:doubao-seed-2-1-pro-260915'
const sse = (text: string) =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
const chatSse = (frames: unknown[], done = true) =>
  sse(
    `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}${done ? 'data: [DONE]\n\n' : ''}`,
  )
const say = (content: string, usage?: unknown) =>
  chatSse([
    { choices: [{ index: 0, delta: { role: 'assistant', content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(usage ? { usage } : {}) },
  ])
const user = [{ role: 'user' as const, content: 'hello' }]
const chat = (model: string, input: Record<string, unknown>, usage?: 'agent') =>
  ({ capability: 'text.chat', model, input, ...(usage ? { usage } : {}) }) as never

describe('对话（按量）', () => {
  it('流式请求体、JSON Schema、用量归一化，并回调 ctx.stream', async () => {
    const { ctx, body } = fakeContext([
      say('{"answer":42}', { prompt_tokens: 3, completion_tokens: 8 }),
    ])
    const deltas: string[] = []
    ctx.stream = (delta) => deltas.push(delta.text)
    const schema = { type: 'object', properties: { answer: { type: 'integer' } } }
    const result = await arkAdapter.submit(
      chat(CHAT, { messages: user, jsonSchema: schema, temperature: 0.2, maxTokens: 100 }),
      ctx,
    )
    expect(body()).toMatchObject({
      model: 'doubao-seed-2-1-pro-260915',
      stream: true,
      temperature: 0.2,
      max_tokens: 100,
      response_format: { type: 'json_schema', json_schema: { schema, strict: true } },
    })
    expect(result).toEqual({
      state: 'succeeded',
      outputs: [{ type: 'json', value: { answer: 42 } }],
      usage: { inputTokens: 3, outputTokens: 8 },
    })
    expect(deltas.join('')).toBe('{"answer":42}')
  })

  it('夹具请求的字段原样到达请求体', async () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const { ctx, body } = fakeContext([say('ok')])
    await arkAdapter.submit(
      chat(CHAT, {
        messages: [{ role: 'user', content: '你好' }],
        temperature: 0.7,
        maxTokens: 1024,
        extra: { thinking: { type: 'enabled' } },
      }),
      ctx,
    )
    expect(body().thinking).toEqual(recorded.request.body?.thinking)
  })

  it('工具声明随请求发送，工具调用原样交回', async () => {
    const { ctx, body } = fakeContext([
      chatSse([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'get_canvas', arguments: '{"depth":1}' },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    ])
    const parameters = { type: 'object', properties: { depth: { type: 'integer' } } }
    const result = await arkAdapter.submit(
      chat(CHAT, {
        messages: user,
        tools: [{ name: 'get_canvas', description: '读画布', parameters }],
      }),
      ctx,
    )
    expect(body()).toMatchObject({
      tools: [{ type: 'function', function: { name: 'get_canvas', parameters } }],
      tool_choice: 'auto',
    })
    expect(result).toMatchObject({
      outputs: [
        {
          type: 'tool_calls',
          calls: [{ id: 'call_1', name: 'get_canvas', arguments: { depth: 1 } }],
        },
      ],
    })
  })

  it('对话图片经 files 读入后使用 data URL', async () => {
    const { ctx, body } = fakeContext([say('ok')])
    ctx.files = { read: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }) }
    await arkAdapter.submit(
      chat(CHAT, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              { type: 'image', image: { assetId: 'a', kind: 'image' } },
            ],
          },
        ],
      }),
      ctx,
    )
    expect((body().messages as Array<{ content: unknown[] }>)[0]!.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' },
    })
  })

  it('没有 files / assets 时图片输入报 invalid_input', async () => {
    const { ctx, fetch } = fakeContext([])
    await expect(
      arkAdapter.submit(
        chat(CHAT, {
          messages: [
            { role: 'user', content: [{ type: 'image', image: { assetId: 'a', kind: 'image' } }] },
          ],
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('流没有以 [DONE] 结束视为中断', async () => {
    const { ctx } = fakeContext([
      chatSse([{ choices: [{ index: 0, delta: { role: 'assistant', content: '半截' } }] }], false),
    ])
    await expect(arkAdapter.submit(chat(CHAT, { messages: user }), ctx)).rejects.toMatchObject({
      code: 'unknown',
    })
  })

  it('空 messages 抛 invalid_input', async () => {
    const { ctx } = fakeContext()
    await expect(arkAdapter.submit(chat(CHAT, { messages: [] }), ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('HTTP 错误按平台规则归类', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate_limit'],
      [500, 'unavailable'],
    ] as const) {
      const { ctx } = fakeContext([
        Response.json({ error: { code: 'x', message: 'bad test-secret' } }, { status }),
      ])
      const error = await arkAdapter.submit(chat(CHAT, { messages: user }), ctx).catch((e) => e)
      expect(error).toMatchObject({ code })
      expect(String(error.message)).not.toContain('test-secret')
    }
  })

  it('自定义模型槽映射至设置中的 Endpoint ID，未填写时不发请求', async () => {
    const { ctx, body, fetch } = fakeContext([say('OK')])
    ctx.settings = { customChatModel: 'ep-custom-chat' }
    await arkAdapter.submit(chat('ark:custom-chat', { messages: user }), ctx)
    expect(body().model).toBe('ep-custom-chat')
    ctx.settings = { customChatModel: '  ' }
    await expect(
      arkAdapter.submit(chat('ark:custom-chat', { messages: user }), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('没有 settings 时自定义槽回退到 ARK_CUSTOM_*_MODEL', async () => {
    const { ctx, body } = fakeContext([say('OK')], {
      secret: { ARK_API_KEY: 'k', ARK_CUSTOM_CHAT_MODEL: 'ep-env' },
    })
    await arkAdapter.submit(chat('ark:custom-chat', { messages: user }), ctx)
    expect(body().model).toBe('ep-env')
  })
})

describe('extra：白名单放行，其余报错', () => {
  it('白名单字段（含 MCP 目录承诺的缓存路由 / 联网 / 续接）到达请求体', async () => {
    const extra = {
      thinking: { type: 'enabled' },
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      prompt_cache_key: 'session-1',
      web_search: { enable: true },
      previous_response_id: 'resp_1',
    }
    const { ctx, body } = fakeContext([say('ok')])
    await arkAdapter.submit(chat(CHAT, { messages: user, extra }), ctx)
    expect(body()).toMatchObject(extra)
  })

  it('白名单外的字段在请求前报 invalid_input（包括 model / messages 等保留字段）', async () => {
    for (const extra of [{ model: 'hacked' }, { messages: [] }, { stream: false }, { foo: 1 }]) {
      const { ctx, fetch } = fakeContext([])
      await expect(
        arkAdapter.submit(chat(CHAT, { messages: user, extra }), ctx),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(fetch).not.toHaveBeenCalled()
    }
  })
})

describe('套餐对话', () => {
  const plan = (replies: unknown[]) =>
    fakeContext(replies, { secret: { ARK_AGENT_PLAN_API_KEY: 'plan-secret' } })
  const PLAN_CHAT = 'ark-plan:doubao-seed-2.1-pro'

  it('使用专属路径与 Key（usage=agent 的拦截由宿主桥接负责，适配器不拦）', async () => {
    const { ctx, fetch, body } = plan([say('hello')])
    const result = await arkPlanAdapter.submit(chat(PLAN_CHAT, { messages: user }, 'agent'), ctx)
    expect(result).toMatchObject({ outputs: [{ type: 'text', text: 'hello' }] })
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',
    )
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer plan-secret',
    })
    expect(body().model).toBe('doubao-seed-2.1-pro')
  })

  it('工具调用累积思考摘要与加密续传内容，并在下一轮原样回传', async () => {
    const { ctx, body } = plan([
      chatSse([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                reasoning_content: '摘',
                encrypted_content: 'opa',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call1',
                    type: 'function',
                    function: { name: 'get_canvas', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ index: 0, delta: { reasoning_content: '要', encrypted_content: 'que' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]),
      say('done'),
    ])
    const tools = [
      { name: 'get_canvas', description: '读画布', parameters: { type: 'object', properties: {} } },
    ]
    const result = await arkPlanAdapter.submit(
      chat(PLAN_CHAT, { messages: user, tools }, 'agent'),
      ctx,
    )
    if (result.state !== 'succeeded') throw new Error('expected success')
    const output = result.outputs.find((o) => o.type === 'tool_calls')
    if (output?.type !== 'tool_calls') throw new Error('expected tool calls')
    expect(output.continuation).toEqual({
      model: 'doubao-seed-2.1-pro',
      reasoningContent: '摘要',
      encryptedContent: 'opaque',
    })
    await arkPlanAdapter.submit(
      chat(
        PLAN_CHAT,
        {
          messages: [
            ...user,
            {
              role: 'assistant',
              content: '',
              toolCalls: output.calls,
              continuation: output.continuation,
            },
            { role: 'tool', content: '{}', toolCallId: 'call1', toolName: 'get_canvas' },
          ],
        },
        'agent',
      ),
      ctx,
    )
    expect((body(1).messages as unknown[])[1]).toMatchObject({
      reasoning_content: '摘要',
      encrypted_content: 'opaque',
    })
  })
})
