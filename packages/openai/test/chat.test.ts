import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type CapabilityInput } from '@modelbay/core'
import {
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
  cancelled: 'OpenAI 请求已取消；生成提交可能已受理',
  network: 'OpenAI 网络请求失败；生成提交结果未知，请勿直接重提',
}

function call(overrides: Partial<ChatCall> = {}): ChatCall {
  const { ctx } = fakeContext()
  return {
    ctx,
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-6-1-sol',
    apiKey: 'sk-recorded-key',
    label: 'OpenAI',
    input: { messages: [{ role: 'user', content: 'Hello' }] },
    messages,
    structured: 'json_schema',
    ...overrides,
  }
}

describe('buildChatBody：请求构造与字段透传', () => {
  it('与录制夹具一致', () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.5,
      maxTokens: 512,
      extra: { reasoning_effort: 'high' },
    }
    expect(buildChatBody(call({ input }), [{ role: 'user', content: 'Hello' }])).toEqual(
      recorded.request.body,
    )
  })

  it('平台特有字段（previous_response_id / 思考 / 联网搜索）原样透传', () => {
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      extra: {
        previous_response_id: 'resp_123',
        reasoning_effort: 'medium',
        thinking: { type: 'enabled' },
        web_search: { enable: true },
        top_p: 0.8,
      },
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.previous_response_id).toBe('resp_123')
    expect(body.reasoning_effort).toBe('medium')
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.web_search).toEqual({ enable: true })
    expect(body.top_p).toBe(0.8)
  })

  it('RESERVED 字段不能被 extra 覆盖', () => {
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      extra: { model: 'hacked', messages: [], stream: true, baseURL: 'https://evil.test' },
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.model).toBe('gpt-6-1-sol')
    expect(body.stream).toBe(false)
    expect(body.baseURL).toBeUndefined()
  })

  it('tools / toolChoice / jsonSchema', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    const input: CapabilityInput<'text.chat'> = {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fn', description: '工具', parameters: { type: 'object' } }],
      toolChoice: 'required',
      jsonSchema: schema,
    }
    const body = buildChatBody(call({ input }), [{ role: 'user', content: 'hi' }])
    expect(body.tool_choice).toBe('required')
    expect(body.tools).toHaveLength(1)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'modelbay_output', schema },
    })
  })
})

describe('buildMessages：消息转换', () => {
  it('assistant continuation 回传 reasoning_content / encrypted_content', async () => {
    const { ctx } = fakeContext()
    const out = await buildMessages(
      ctx,
      {
        messages: [
          {
            role: 'assistant',
            content: '思考中',
            continuation: {
              model: 'gpt-6-astra',
              reasoningContent: '推理片段',
              encryptedContent: 'enc-recorded',
            },
          },
        ],
      },
      'OpenAI',
    )
    expect(out[0]).toMatchObject({
      reasoning_content: '推理片段',
      encrypted_content: 'enc-recorded',
    })
  })

  it('图片输入通过 assets 转 data URL；无 assets 时报错', async () => {
    const { ctx } = fakeContext([], {
      assets: { load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }) },
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
      'OpenAI',
    )
    expect(out[0]).toMatchObject({
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ],
    })
    await expect(
      imageDataUrl(fakeContext().ctx, { assetId: 'a1', kind: 'image' }, 'OpenAI'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('parseChatResponse：响应解析', () => {
  it('成功文本 + 用量', () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const result = parseChatResponse(call(), recorded.response.body as Record<string, unknown>)
    expect(result.state).toBe('succeeded')
    if (result.state === 'succeeded') {
      expect(result.outputs).toEqual([{ type: 'text', text: 'Hi there!' }])
      expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 4 })
    }
  })

  it('工具调用 + continuation', () => {
    const recorded = fixture<RecordedCall>('chat-tool-calls')
    const result = parseChatResponse(call(), recorded.response.body as Record<string, unknown>)
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    const calls = result.outputs.find((item) => item.type === 'tool_calls')
    expect(calls).toMatchObject({
      calls: [{ id: 'call_2', name: 'get_weather', arguments: { city: '北京' } }],
    })
    if (calls?.type === 'tool_calls')
      expect(calls.continuation).toMatchObject({ encryptedContent: '<redacted>' })
  })

  it('jsonSchema 结构化输出与错误分支', () => {
    const withSchema = call({
      input: { messages: [{ role: 'user', content: 'hi' }], jsonSchema: { type: 'object' } },
    })
    expect(
      parseChatResponse(withSchema, { choices: [{ message: { content: '{"a":1}' } }] }),
    ).toMatchObject({ state: 'succeeded', outputs: [{ type: 'json', value: { a: 1 } }] })
    expect(() =>
      parseChatResponse(withSchema, { choices: [{ message: { content: 'bad' } }] }),
    ).toThrow(ProviderError)
    expect(() =>
      parseChatResponse(call(), { choices: [{ finish_reason: 'content_filter' }] }),
    ).toThrow(/拒绝生成/)
    expect(() => parseChatResponse(call(), { choices: [] })).toThrow(/缺少对话内容/)
  })
})

describe('chatCompletion：完整请求 + 错误映射', () => {
  it('URL / headers / body 与录制夹具一致', async () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const { ctx, fetch } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { OPENAI_API_KEY: 'sk-recorded-key' },
    })
    await chatCompletion(
      call({
        ctx,
        apiKey: 'sk-recorded-key',
        input: {
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.5,
          maxTokens: 512,
          extra: { reasoning_effort: 'high' },
        },
      }),
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer sk-recorded-key')
    expect(JSON.parse(String(init?.body))).toEqual(recorded.request.body)
  })

  it('401 / 429 / 5xx / quota / content_policy 错误码映射', async () => {
    const recorded = fixture<{ cases: Array<{ status: number; body: unknown; code: string }> }>(
      'chat-errors',
    )
    for (const item of recorded.cases) {
      const { ctx } = fakeContext([jsonResponse(item.body, item.status)])
      await expect(chatCompletion(call({ ctx, apiKey: 'sk-k' }))).rejects.toMatchObject({
        code: item.code,
      })
    }
  })

  it('上游 key 不进入错误信息', async () => {
    const { ctx } = fakeContext([
      jsonResponse(
        { error: { code: 'auth', message: 'bad key sk-secret-abc for account acct-123' } },
        401,
      ),
    ])
    await expect(chatCompletion(call({ ctx, apiKey: 'sk-secret-abc' }))).rejects.toMatchObject({
      code: 'auth',
      message: expect.not.stringContaining('sk-secret-abc'),
    })
  })

  it('夹具里的 Authorization / key / 账号 ID 已 <redacted>', () => {
    const recorded = fixture<RecordedCall>('chat-success')
    expect(recorded.request.headers.Authorization).toBe('Bearer <redacted>')
    expect(JSON.stringify(fixture('chat-errors'))).toContain('<redacted>')
  })

  it('空 messages 抛 invalid_input', async () => {
    const { ctx } = fakeContext()
    await expect(chatCompletion(call({ ctx, input: { messages: [] } }))).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
