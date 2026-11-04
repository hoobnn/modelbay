import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type CapabilityInput } from '@modelbay/core'
import {
  RESERVED,
  buildChatBody,
  buildMessages,
  chatCompletion,
  imageDataUrl,
  parseChatResponse,
  type ChatCall,
} from '../src/chat'
import type { TransportMessages } from '../src/http'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

const messages: TransportMessages = {
  cancelled: '火山方舟请求已取消',
  network: '火山方舟网络请求失败；对话结果可能未知，不会自动重新提交',
}

function call(overrides: Partial<ChatCall> = {}): ChatCall {
  const { ctx } = fakeContext()
  return {
    ctx,
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-seed-2-1-pro-260628',
    apiKey: 'sk-recorded-key',
    label: '火山方舟',
    input: { messages: [{ role: 'user', content: '你好' }] },
    messages,
    structured: 'json_schema',
    ...overrides,
  }
}

describe('buildChatBody：请求构造与字段透传', () => {
  it('基础字段与录制夹具一致', () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: '你好' }],
      temperature: 0.7,
      maxTokens: 1024,
      extra: { thinking: { type: 'enabled' } },
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: '你好' }])
    expect(body).toEqual(recorded.request.body)
  })

  it('平台特有字段（thinking / 联网搜索 / previous_response_id）原样透传', () => {
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      extra: {
        thinking: { type: 'enabled' },
        web_search: { enable: true },
        previous_response_id: 'resp_123',
        top_p: 0.9,
        frequency_penalty: 0.2,
      },
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.web_search).toEqual({ enable: true })
    expect(body.previous_response_id).toBe('resp_123')
    expect(body.top_p).toBe(0.9)
    expect(body.frequency_penalty).toBe(0.2)
  })

  it('RESERVED 字段不能被 extra 覆盖', () => {
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      extra: { model: 'hacked', messages: [], stream: true, baseURL: 'https://evil.test' },
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.model).toBe('doubao-seed-2-1-pro-260628')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.stream).toBe(false)
    expect(body.baseURL).toBeUndefined()
    expect(RESERVED.has('baseURL')).toBe(true)
  })

  it('tools / toolChoice 转成 OpenAI 工具声明', () => {
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_weather', description: '查天气', parameters: { type: 'object' } }],
      toolChoice: 'required',
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_weather', description: '查天气', parameters: { type: 'object' } },
      },
    ])
    expect(body.tool_choice).toBe('required')
  })

  it('jsonSchema 按 json_schema / json_object 生成不同 response_format', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      jsonSchema: schema,
    }
    const strict = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(strict.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'modelbay_output', schema },
    })
    const loose = buildChatBody(call({ input, structured: 'json_object' }), [
      { role: 'user', content: 'hi' },
    ])
    expect(loose.response_format).toEqual({ type: 'json_object' })
  })

  it('providerFields 注入通道专属字段', () => {
    const body = buildChatBody(call({ providerFields: { store: false } }), [
      { role: 'user', content: 'hi' },
    ])
    expect(body.store).toBe(false)
  })
})

describe('buildMessages：消息转换', () => {
  const ctx = () => fakeContext().ctx

  it('system / user / assistant / tool 四种角色', async () => {
    const out = await buildMessages(
      ctx(),
      {
        messages: [
          { role: 'system', content: '你是助手' },
          { role: 'user', content: '你好' },
          {
            role: 'assistant',
            content: '调用工具',
            toolCalls: [{ id: 'c1', name: 'fn', arguments: { x: 1 } }],
          },
          { role: 'tool', toolCallId: 'c1', toolName: 'fn', content: '结果' },
        ],
      },
      '火山方舟',
    )
    expect(out[0]).toEqual({ role: 'system', content: '你是助手' })
    expect(out[2]).toMatchObject({
      role: 'assistant',
      content: '调用工具',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{"x":1}' } }],
    })
    expect(out[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1', name: 'fn' })
  })

  it('continuation 变成 reasoning_content / encrypted_content 原样回传', async () => {
    const out = await buildMessages(
      ctx(),
      {
        messages: [
          {
            role: 'assistant',
            content: '思考中',
            continuation: {
              model: 'doubao-seed-2.1-pro',
              reasoningContent: '推理片段',
              encryptedContent: 'enc-recorded',
            },
          },
        ],
      },
      '火山方舟',
    )
    expect(out[0]).toMatchObject({
      reasoning_content: '推理片段',
      encrypted_content: 'enc-recorded',
    })
  })

  it('混排图片通过 assets 转成 data URL', async () => {
    const { ctx } = fakeContext([], {
      assets: {
        load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }),
      },
    })
    const out = await buildMessages(
      ctx,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '看图' },
              { type: 'image', image: { assetId: 'a1', kind: 'image' } },
            ],
          },
        ],
      },
      '火山方舟',
    )
    expect(out[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ],
    })
  })

  it('没有 assets 时图片输入报 invalid_input', async () => {
    await expect(
      imageDataUrl(ctx(), { assetId: 'a1', kind: 'image' }, '火山方舟'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('parseChatResponse：响应解析', () => {
  it('成功文本 + 用量', () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const result = parseChatResponse(call(), recorded.response.body as Record<string, unknown>)
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.outputs).toEqual([{ type: 'text', text: '你好，有什么可以帮你？' }])
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 9 })
  })

  it('工具调用携带思考续传 continuation', () => {
    const recorded = fixture<RecordedCall>('chat-tool-calls')
    const result = parseChatResponse(call(), recorded.response.body as Record<string, unknown>)
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    const toolCalls = result.outputs.find((item) => item.type === 'tool_calls')
    expect(toolCalls).toMatchObject({
      type: 'tool_calls',
      calls: [{ id: 'call_2', name: 'get_weather', arguments: { city: '北京' } }],
    })
    if (toolCalls?.type === 'tool_calls') {
      expect(toolCalls.continuation).toEqual({
        model: 'doubao-seed-2-1-pro-260628',
        reasoningContent: '继续思考',
        encryptedContent: '<redacted>',
      })
    }
  })

  it('jsonSchema 时返回结构化 json 输出', () => {
    const result = parseChatResponse(
      call({
        input: { messages: [{ role: 'user', content: 'hi' }], jsonSchema: { type: 'object' } },
      }),
      { choices: [{ message: { content: '{"a":1}' } }] },
    )
    expect(result.state).toBe('succeeded')
    if (result.state === 'succeeded')
      expect(result.outputs).toEqual([{ type: 'json', value: { a: 1 } }])
  })

  it('结构化内容不是 JSON 时抛 unknown', () => {
    expect(() =>
      parseChatResponse(
        call({
          input: { messages: [{ role: 'user', content: 'hi' }], jsonSchema: { type: 'object' } },
        }),
        { choices: [{ message: { content: 'not json' } }] },
      ),
    ).toThrow(ProviderError)
  })

  it('content_filter 抛 content_policy，空响应抛 unknown', () => {
    expect(() =>
      parseChatResponse(call(), { choices: [{ finish_reason: 'content_filter' }] }),
    ).toThrow(/拒绝生成/)
    expect(() => parseChatResponse(call(), { choices: [] })).toThrow(/缺少对话内容/)
  })
})

describe('chatCompletion：完整请求 + 错误映射', () => {
  function adapterFetch(recorded: RecordedCall) {
    const { ctx, fetch } = fakeContext([
      jsonResponse(recorded.response.body, recorded.response.status),
    ])
    return { ctx, fetch }
  }

  it('URL / headers / body 与录制夹具一致，且 key 不出现在请求外', async () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const { ctx, fetch } = adapterFetch(recorded)
    await chatCompletion(
      call({
        ctx,
        apiKey: 'sk-recorded-key',
        input: {
          messages: [{ role: 'user', content: '你好' }],
          temperature: 0.7,
          maxTokens: 1024,
          extra: { thinking: { type: 'enabled' } },
        },
      }),
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer sk-recorded-key')
    expect(JSON.parse(String(init?.body))).toEqual(recorded.request.body)
  })

  it('夹具里 Authorization / key / 账号 ID 已 <redacted>', () => {
    const recorded = fixture<RecordedCall>('chat-error-429')
    expect(recorded.request.headers.Authorization).toBe('Bearer <redacted>')
    expect(JSON.stringify(recorded)).toContain('<redacted>')
  })

  it('429 映射为 rate_limit', async () => {
    const recorded = fixture<RecordedCall>('chat-error-429')
    const { ctx } = adapterFetch(recorded)
    await expect(chatCompletion(call({ ctx, apiKey: 'sk-recorded-key' }))).rejects.toMatchObject({
      code: 'rate_limit',
    })
  })

  it('401 / 500 映射为 auth / unavailable', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [500, 'unavailable'],
    ] as const) {
      const { ctx } = fakeContext([jsonResponse({ error: { message: '失败' } }, status)])
      await expect(chatCompletion(call({ ctx, apiKey: 'sk-k' }))).rejects.toMatchObject({ code })
    }
  })

  it('空 messages 抛 invalid_input', async () => {
    const { ctx } = fakeContext()
    await expect(chatCompletion(call({ ctx, input: { messages: [] } }))).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
