import { describe, expect, it } from 'vite-plus/test'
import { createAdapterContext, type AdapterRequest } from '@modelbay/core'
import { chat } from '../src/chat'
import flash from '../src/models/deepseek-flash'
import pro from '../src/models/deepseek-v4-pro'

const input = { messages: [{ role: 'user' as const, content: 'hello' }] }
function request(extra = {}, rest = {}): AdapterRequest<'text.chat'> {
  return { capability: 'text.chat', model: 'deepseek-flash', input: { ...input, ...rest, extra } }
}
function sse(frames: unknown[], done = false) {
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') +
      (done ? 'data: [DONE]\r\n\r\n' : ''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
const say = (text: string) =>
  sse(
    [
      { choices: [{ index: 0, delta: { role: 'assistant', content: text } }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 8 },
      },
    ],
    true,
  )
function context(response: Response) {
  let body: Record<string, unknown> = {}
  let url = ''
  let count = 0
  const deltas: string[] = []
  const ctx = createAdapterContext({
    secrets: { DEEPSEEK_API_KEY: 'sk-test' },
    stream: ({ text }) => deltas.push(text),
    fetchImpl: async (target, init) => {
      url = String(target)
      count++
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-test')
      return response
    },
  })
  return { ctx, deltas, body: () => body, url: () => url, count: () => count }
}
const terminal = (output: unknown[], rest = {}) =>
  sse([
    { type: 'response.output_text.delta', delta: 'answer' },
    {
      type: 'response.completed',
      response: {
        id: 'r1',
        status: 'completed',
        output,
        usage: { input_tokens: 10, output_tokens: 20 },
        ...rest,
      },
    },
  ])
const answer = (text: string) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
})

describe('DeepSeek chat', () => {
  it('streams Chat Completions, forwards options and normalizes usage', async () => {
    const c = context(say('hi'))
    const out = await chat(
      request({ thinking: { type: 'disabled' }, user: 'u1' }, { temperature: 0.4, maxTokens: 42 }),
      c.ctx,
      flash,
    )
    expect(c.url()).toBe('https://api.deepseek.com/chat/completions')
    expect(c.body()).toMatchObject({
      model: 'deepseek-flash',
      stream: true,
      temperature: 0.4,
      max_tokens: 42,
      thinking: { type: 'disabled' },
      user_id: 'u1',
    })
    expect(c.body()).not.toHaveProperty('user')
    expect(c.deltas.join('')).toBe('hi')
    expect(out).toMatchObject({
      outputs: [{ type: 'text', text: 'hi' }],
      usage: { inputTokens: 3, outputTokens: 8 },
    })
  })

  it('requests json_object with an instruction and validates the schema', async () => {
    const c = context(say('{"answer":42}'))
    const out = await chat(
      request(
        {},
        {
          jsonSchema: {
            type: 'object',
            properties: { answer: { type: 'integer' } },
            required: ['answer'],
          },
        },
      ),
      c.ctx,
      flash,
    )
    expect(c.body()).toMatchObject({
      response_format: { type: 'json_object' },
      messages: [{ role: 'system' }, { role: 'user' }],
    })
    expect(out).toMatchObject({ outputs: [{ type: 'json', value: { answer: 42 } }] })
    await expect(
      chat(request({}, { jsonSchema: { type: 'object' } }), context(say('no JSON')).ctx, flash),
    ).rejects.toMatchObject({ code: 'unknown' })
  })

  it('preserves reasoning with tools and replays it on the next turn', async () => {
    const c = context(
      sse(
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  reasoning_content: 'reason',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{"q":"a"}' },
                    },
                  ],
                },
              },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ],
        true,
      ),
    )
    const out = await chat(
      request(
        {},
        { tools: [{ name: 'lookup', description: 'lookup', parameters: { type: 'object' } }] },
      ),
      c.ctx,
      flash,
    )
    expect(out).toMatchObject({
      outputs: [
        {
          type: 'tool_calls',
          calls: [{ id: 'call1', name: 'lookup', arguments: { q: 'a' } }],
          continuation: { model: 'deepseek-flash', reasoningContent: 'reason' },
        },
      ],
    })
    const next = context(say('done'))
    await chat(
      request(
        {},
        {
          messages: [
            input.messages[0],
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call1', name: 'lookup', arguments: {} }],
              continuation: { model: 'deepseek-flash', reasoningContent: 'reason' },
            },
            { role: 'tool', content: 'result', toolCallId: 'call1', toolName: 'lookup' },
          ],
        },
      ),
      next.ctx,
      flash,
    )
    expect((next.body().messages as Record<string, unknown>[])[1]).toMatchObject({
      reasoning_content: 'reason',
    })
  })

  it('rejects reserved/unknown options and pro image input before sending', async () => {
    const c = context(say('hi'))
    await expect(chat(request({ model: 'wrong' }), c.ctx, flash)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      chat(
        request(
          {},
          {
            messages: [
              {
                role: 'user',
                content: [{ type: 'image', image: { assetId: 'a', kind: 'image' } }],
              },
            ],
          },
        ),
        c.ctx,
        pro,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(c.count()).toBe(0)
  })

  it('encodes vision via host assets and rejects unsupported media', async () => {
    const c = context(say('image'))
    c.ctx.assets = { load: async () => ({ data: new Uint8Array([1]), mime: 'image/png' }) }
    await chat(
      request(
        {},
        {
          messages: [
            { role: 'user', content: [{ type: 'image', image: { assetId: 'a', kind: 'image' } }] },
          ],
        },
      ),
      c.ctx,
      flash,
    )
    expect(JSON.stringify(c.body())).toContain('data:image/png;base64,AQ==')
    c.ctx.assets = { load: async () => ({ data: new Uint8Array([1]), mime: 'video/mp4' }) }
    await expect(
      chat(
        request(
          {},
          {
            messages: [
              {
                role: 'user',
                content: [{ type: 'image', image: { assetId: 'a', kind: 'image' } }],
              },
            ],
          },
        ),
        c.ctx,
        flash,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects incomplete Chat SSE without retry', async () => {
    const c = context(sse([{ choices: [{ index: 0, delta: { content: 'partial' } }] }]))
    await expect(chat(request(), c.ctx, flash)).rejects.toMatchObject({
      code: 'unknown',
      retryable: false,
    })
    expect(c.count()).toBe(1)
  })

  it('routes web tools to Responses and retains citations, signatures, title and billing', async () => {
    const web = { type: 'web_search_call', kind: 'read_link', signature: 'opaque', id: 'w1' }
    const c = context(
      terminal(
        [
          web,
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'answer',
                annotations: [{ type: 'url_citation', url: 'https://example.com' }],
              },
            ],
          },
        ],
        {
          title: 'Test',
          usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { tool_fetch: 1 } },
        },
      ),
    )
    const out = await chat(
      request({ read_url: true, thinking: { type: 'disabled' } }),
      c.ctx,
      flash,
    )
    expect(c.url()).toBe('https://api.deepseek.com/responses')
    expect(c.body()).toMatchObject({
      reasoning: { effort: 'none' },
      tools: [{ type: 'deepseek_read_url' }],
      input: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    expect(out).toMatchObject({
      outputs: [
        { type: 'text', text: 'answer' },
        {
          type: 'json',
          value: {
            web_searches: [web],
            title: 'Test',
            server_tool_use: { tool_fetch: 1 },
            citations: [{ url: 'https://example.com' }],
          },
        },
      ],
    })
  })

  it('Responses handles tool continuation and strict schema', async () => {
    const c = context(
      terminal([
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'reason' }] },
        { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"q":1}' },
      ]),
    )
    const out = await chat(
      request(
        { api: 'responses', reasoning_effort: 'max' },
        {
          tools: [{ name: 'lookup', description: 'l', parameters: { type: 'object' } }],
          maxTokens: 50,
        },
      ),
      c.ctx,
      flash,
    )
    expect(c.body()).toMatchObject({
      reasoning: { effort: 'max' },
      max_output_tokens: 50,
      tools: [{ type: 'function', name: 'lookup' }],
    })
    expect(out).toMatchObject({
      outputs: [{ type: 'tool_calls', continuation: { reasoningContent: 'reason' } }],
    })
    const schema = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }
    const s = context(terminal([answer('{"n":1}')]))
    await chat(request({ api: 'responses' }, { jsonSchema: schema }), s.ctx, flash)
    expect(s.body()).toMatchObject({ text: { format: { type: 'json_schema', schema } } })
  })

  it('Responses rejects incompatible web schema and stops, plus malformed or missing terminals', async () => {
    const c = context(terminal([answer('ok')]))
    await expect(
      chat(request({ web_search: true }, { jsonSchema: { type: 'object' } }), c.ctx, flash),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      chat(request({ api: 'responses', stop: 'x' }), c.ctx, flash),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(c.count()).toBe(0)
    await expect(
      chat(
        request({ api: 'responses' }),
        context(sse([{ type: 'response.output_text.delta', delta: 'partial' }])).ctx,
        flash,
      ),
    ).rejects.toMatchObject({ outcome: 'unknown' })
    await expect(
      chat(
        request({ api: 'responses' }),
        context(
          new Response('data: invalid\n\n', { headers: { 'content-type': 'text/event-stream' } }),
        ).ctx,
        flash,
      ),
    ).rejects.toMatchObject({ outcome: 'unknown' })
  })

  it('Responses distinguishes refusal, failure and truncated structured output', async () => {
    await expect(
      chat(
        request({ api: 'responses' }),
        context(
          terminal([], { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }),
        ).ctx,
        flash,
      ),
    ).rejects.toMatchObject({ code: 'content_policy' })
    await expect(
      chat(
        request({ api: 'responses' }),
        context(
          terminal([], { status: 'failed', error: { code: 'server_error', message: 'failed' } }),
        ).ctx,
        flash,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
    await expect(
      chat(
        request({ api: 'responses' }, { jsonSchema: { type: 'object' } }),
        context(
          terminal([answer('{"n":1}')], {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
        ).ctx,
        flash,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})
