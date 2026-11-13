/** MCP → DeepSeek 真实适配器；注入 fetch 验证参数与协议路由，不联网。 */
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  method: string
  body: Record<string, unknown>
}
function setup(reply: () => Response) {
  const platform = platformOf('deepseek')
  const adapter = platform.createAdapters()[0]!
  const captured: Captured[] = []
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, { DEEPSEEK_API_KEY: 'test-key' }),
      fetchImpl: async (url, init) => {
        captured.push({
          url: String(url),
          method: init?.method ?? 'GET',
          body:
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {},
        })
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
        return reply()
      },
    }),
    groups: MCP_TOOL_GROUPS.all,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    serverInfo: { name: 'test', version: '0.0.0' },
  })
  return { handlers, captured }
}
function chatSse() {
  return new Response(
    [
      'data: ' +
        JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }] }),
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]',
    ].join('\n\n') + '\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
function responseSse() {
  return new Response(
    'data: ' +
      JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'r1',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        },
      }) +
      '\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('MCP DeepSeek 工具经真实适配器', () => {
  it('chat flat fields and parameters reach Chat Completions', async () => {
    const { handlers, captured } = setup(chatSse)
    const result = await handlers.callTool('chat', {
      model: 'deepseek:deepseek-flash',
      prompt: 'hi',
      system: 'be brief',
      reasoning_effort: 'low',
      max_tokens: 64,
      temperature: 0.5,
      parameters: { top_p: 0.99, user: 'u1' },
    })
    expect(result.isError).toBeFalsy()
    expect(captured.at(-1)).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      body: {
        model: 'deepseek-flash',
        reasoning_effort: 'low',
        top_p: 0.99,
        user_id: 'u1',
        max_tokens: 64,
        temperature: 0.5,
        stream: true,
      },
    })
    expect(captured.at(-1)!.body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('declared fields route built-in web tools and thinking to Responses', async () => {
    const { handlers, captured } = setup(responseSse)
    const tools = await handlers.listTools()
    expect(tools.find((t) => t.name === 'chat')?.inputSchema.properties).toHaveProperty(
      'web_search',
    )
    const result = await handlers.callTool('chat', {
      model: 'deepseek-flash',
      prompt: 'latest news',
      web_search: true,
      thinking: { type: 'disabled' },
      parameters: { title: { enabled: true } },
    })
    expect(result.isError).toBeFalsy()
    expect(captured[0]).toMatchObject({
      url: 'https://api.deepseek.com/responses',
      body: {
        reasoning: { effort: 'none' },
        tools: [{ type: 'deepseek_web_search' }],
        title: { enabled: true },
      },
    })
  })

  it('invalid declaration options fail before sending', async () => {
    const { handlers, captured } = setup(chatSse)
    await expect(
      handlers.callTool('chat', {
        model: 'deepseek-flash',
        prompt: 'hi',
        reasoning_effort: 'bogus',
      }),
    ).rejects.toThrow(/reasoning_effort/)
    await expect(
      handlers.callTool('chat', {
        model: 'deepseek-flash',
        prompt: 'hi',
        parameters: { model: 'wrong' },
      }),
    ).rejects.toThrow(/extra.model/)
    expect(captured).toHaveLength(0)
  })

  it('named search and fetch tools route their arguments without a synthetic model', async () => {
    const { handlers, captured } = setup(() => Response.json({ results: [] }))
    const result = await handlers.callTool('search_web', {
      query: 'DeepSeek',
      count: 3,
      localization: 'zh-cn',
      need_content: true,
    })
    expect(result.isError).toBeFalsy()
    expect(captured[0]).toEqual({
      url: 'https://api.deepseek.com/v1/tools/search',
      method: 'POST',
      body: { query: 'DeepSeek', count: 3, localization: 'zh-cn', need_content: true },
    })
    await handlers.callTool('fetch_url', { url: 'https://example.com' })
    expect(captured[1]).toMatchObject({
      url: 'https://api.deepseek.com/v1/tools/fetch',
      body: { url: 'https://example.com' },
    })
  })

  it.each([
    ['create_response', '/responses', { model: 'deepseek-flash', input: 'hello' }],
    [
      'create_message',
      '/anthropic/v1/messages',
      { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 },
    ],
    [
      'complete_fim',
      '/beta/completions',
      { model: 'deepseek-flash', prompt: 'def ', suffix: 'pass' },
    ],
    [
      'create_chat_completion',
      '/chat/completions',
      { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] },
    ],
  ] as const)('%s preserves complete protocol bodies', async (tool, path, body) => {
    const { handlers, captured } = setup(() =>
      Response.json({ id: 'r1', opaque_extension: { signature: 'keep' } }),
    )
    const result = await handlers.callTool(tool, { body })
    expect(result.isError).toBeFalsy()
    expect(captured[0]).toEqual({ url: `https://api.deepseek.com${path}`, method: 'POST', body })
    expect(JSON.stringify(result)).toContain('opaque_extension')
  })
})
