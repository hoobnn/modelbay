import { ProviderError, type CapabilityInput } from '@modelbay/core'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type ChatOptions, chatCompletion } from '../src/llm'
import { requestBody, sse } from './helpers'

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra = {}) =>
  `data: ${JSON.stringify({ id: 'c', choices: [{ delta, finish_reason: finish }], ...extra })}\n\n`
const done = 'data: [DONE]\n\n'

function run(
  reply: Response | Error,
  input: Partial<CapabilityInput<'text.chat'>> = {},
  patch: Partial<ChatOptions> = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (reply instanceof Error) throw reply
    return reply
  })
  const stream = vi.fn()
  const opts: ChatOptions = {
    ctx: { signal: new AbortController().signal, stream },
    label: '测试',
    baseURL: 'https://llm.test/v1',
    fetch,
    model: 'm',
    input: { messages: [{ role: 'user', content: 'hi' }], ...input },
    image: async () => 'data:image/png;base64,AQID',
    structured: 'json_schema',
    streamError: (e) => new ProviderError('unknown', `流错误:${String(e.message)}`),
    ...patch,
  }
  return { go: () => chatCompletion(opts), fetch, stream }
}

describe('chatCompletion：流式、工具与结构化输出', () => {
  it('文本增量回调 ctx.stream，并归一化用量', async () => {
    const f = run(
      sse(
        chunk({ content: 'he' }) +
          chunk({ content: 'llo' }, 'stop', { usage: { prompt_tokens: 3, completion_tokens: 2 } }) +
          done,
      ),
    )
    expect(await f.go()).toMatchObject({
      outputs: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 3, outputTokens: 2 },
    })
    expect(f.stream).toHaveBeenCalledWith({ text: 'he' })
  })

  it('工具调用交回宿主，历史里的 assistant / tool / 图片消息被转换', async () => {
    const tc = {
      tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{"a":1}' } }],
    }
    const f = run(sse(chunk(tc, 'tool_calls') + done), {
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'sys' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see' },
            { type: 'image', image: { assetId: 'a', kind: 'image' } },
          ],
        },
        {
          role: 'assistant',
          content: 'ok',
          toolCalls: [{ id: 'p', name: 'read', arguments: {} }],
        },
        { role: 'tool', content: 'res', toolCallId: 'p', toolName: 'read' },
      ],
      tools: [{ name: 'read', description: 'd', parameters: { type: 'object', properties: {} } }],
    })
    expect(await f.go()).toMatchObject({
      outputs: [{ type: 'tool_calls', calls: [{ id: 'c1', name: 'read', arguments: { a: 1 } }] }],
    })
    const body = requestBody(f.fetch)
    expect(body.tools).toHaveLength(1)
    expect(JSON.stringify(body.messages)).toContain('data:image/png;base64,AQID')
  })

  it('结构化输出：符合 Schema 返回 json，不符合报错，json_object 档把 Schema 写进系统提示', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
    const good = run(sse(chunk({ content: '{"ok":true}' }, 'stop') + done), { jsonSchema: schema })
    expect(await good.go()).toMatchObject({ outputs: [{ type: 'json', value: { ok: true } }] })
    const bad = run(sse(chunk({ content: '{"ok":1}' }, 'stop') + done), { jsonSchema: schema })
    await expect(bad.go()).rejects.toThrow('结构化内容')
    const loose = run(
      sse(chunk({ content: '{"ok":true}' }, 'stop') + done),
      { jsonSchema: schema },
      { structured: 'json_object' },
    )
    await loose.go()
    expect(JSON.stringify(requestBody(loose.fetch).messages)).toContain('Return only JSON')
    const cut = run(sse(chunk({ content: '{"ok"' }, 'length') + done), { jsonSchema: schema })
    await expect(cut.go()).rejects.toThrow()
  })

  it('内容过滤、空回答、被 extra 覆盖的保留字段', async () => {
    const filtered = run(sse(chunk({}, 'content_filter') + done))
    await expect(filtered.go()).rejects.toMatchObject({ code: 'content_policy' })
    const empty = run(sse(chunk({}, 'stop') + done))
    await expect(empty.go()).rejects.toThrow('缺少对话内容')
    const f = run(sse(chunk({ content: 'x' }, 'stop') + done), {
      extra: { model: 'evil', top_k: 3 },
    })
    await f.go()
    expect(requestBody(f.fetch)).toMatchObject({ model: 'm', top_k: 3 })
  })

  it('流里的错误帧交给适配器归类；已取消和无法解析的数据各自归类', async () => {
    const frame = run(sse(`data: ${JSON.stringify({ error: { message: 'boom', code: 'x' } })}\n\n`))
    await expect(frame.go()).rejects.toThrow('流错误')
    const aborted = new AbortController()
    aborted.abort()
    const cancelled = run(new Error('network'), {}, { ctx: { signal: aborted.signal } })
    await expect(cancelled.go()).rejects.toMatchObject({ code: 'cancelled' })
    const garbled = run(sse('data: not-json\n\n' + done))
    await expect(garbled.go()).rejects.toMatchObject({ code: 'unknown' })
  })
})
