/**
 * OpenAI MCP 工具 → 真实适配器（注入 fetch，不联网）：
 * 断言扁平字段与 parameters 确实落进 /responses 和 /images 的请求体。
 */
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  body: Record<string, unknown>
}

function handlersWith(reply: (url: string) => Response) {
  const platform = platformOf('openai')
  const adapter = platform.createAdapters()[0]!
  const captured: Captured[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    captured.push({ url: String(url), body })
    return reply(String(url))
  }) as typeof fetch
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, { OPENAI_API_KEY: 'k' }),
      fetchImpl,
      assets: createMcpAssetSource({ fetchImpl }),
    }),
    groups: MCP_TOOL_GROUPS.all,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    serverInfo: { name: 'test', version: '0.0.0' },
  })
  return { handlers, captured }
}

const responsesSse = () =>
  new Response(
    [
      { type: 'response.created', response: { id: 'r1', created_at: 1, model: 'm' } },
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
        delta: 'ok',
      },
      {
        type: 'response.completed',
        response: {
          id: 'r1',
          created_at: 1,
          model: 'm',
          status: 'completed',
          output: [],
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const PNG = 'iVBORw0KGgo='
const imageJson = () => Response.json({ data: [{ b64_json: PNG }], usage: { total_tokens: 1 } })

describe('MCP OpenAI 工具经真实适配器', () => {
  it('chat：prompt / system 进 input，reasoning_effort、verbosity、parameters 进请求体', async () => {
    const { handlers, captured } = handlersWith(responsesSse)
    await handlers.callTool('chat', {
      model: 'openai:gpt-6.1-terra',
      prompt: 'hi',
      system: 'be brief',
      reasoning_effort: 'low',
      verbosity: 'low',
      max_tokens: 64,
      parameters: { service_tier: 'flex' },
    })
    const request = captured.at(-1)!
    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.body).toMatchObject({
      model: 'gpt-6.1-terra',
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 64,
      service_tier: 'flex',
      store: false,
    })
    expect(JSON.stringify(request.body.input)).toContain('hi')
    expect(JSON.stringify(request.body.input)).toContain('be brief')
  })

  it('chat：声明里的字段按声明校验取值，声明外的原样透传', async () => {
    const { handlers, captured } = handlersWith(responsesSse)
    await expect(
      handlers.callTool('chat', {
        model: 'openai:gpt-6.1-terra',
        prompt: 'hi',
        reasoning_effort: 'bogus',
      }),
    ).rejects.toThrow(/reasoning_effort/)
    await handlers.callTool('chat', {
      model: 'openai:gpt-6.1-terra',
      prompt: 'hi',
      parameters: { metadata: { run: 'x' } },
    })
    expect(captured.at(-1)!.body.metadata).toEqual({ run: 'x' })
  })

  it('generate_image：声明外的 parameters 报错而不是静默忽略', async () => {
    const { handlers } = handlersWith(imageJson)
    await expect(
      handlers.callTool('generate_image', {
        model: 'openai:gpt-image-2.6-flare',
        prompt: '猫',
        parameters: { not_a_field: 1 },
      }),
    ).rejects.toThrow(/not_a_field/)
  })

  it('generate_image：aspect_ratio 换算成 size，quality / background / output_format / n 进请求体', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'openai:gpt-image-2.6-flare',
      prompt: '猫',
      aspect_ratio: '16:9',
      n: 2,
      quality: 'low',
      background: 'transparent',
      output_format: 'webp',
      parameters: { complexity: 'low' },
    })
    const request = captured[0]!
    expect(request.url).toBe('https://api.openai.com/v1/images/generations')
    expect(request.body).toMatchObject({
      model: 'gpt-image-2.6-flare',
      size: '1536x864',
      n: 2,
      quality: 'low',
      background: 'transparent',
      output_format: 'webp',
      complexity: 'low',
    })
  })

  it('generate_image：size 优先于 aspect_ratio；带 images 走 /images/edits', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'openai:gpt-image-2.6-flare',
      prompt: '换成蓝色',
      size: '1024x1024',
      aspect_ratio: '16:9',
      images: [`data:image/png;base64,${PNG}`],
    })
    const request = captured.at(-1)!
    expect(request.url).toBe('https://api.openai.com/v1/images/edits')
    expect(request.body.size).toBe('1024x1024')
    expect(JSON.stringify(request.body.images)).toContain('data:image/png;base64')
  })

  it('从声明派生的顶层字段也进请求体，不会被丢掉', async () => {
    const { handlers, captured } = handlersWith(responsesSse)
    const tools = handlers.listTools()
    const chat = tools.find((tool) => tool.name === 'chat')!
    expect(Object.keys(chat.inputSchema.properties ?? {})).toContain('previous_response_id')
    await handlers.callTool('chat', {
      model: 'openai:gpt-6.1-terra',
      prompt: 'continue',
      previous_response_id: 'resp_1',
      service_tier: 'flex',
    })
    expect(captured.at(-1)!.body).toMatchObject({
      previous_response_id: 'resp_1',
      service_tier: 'flex',
    })
  })

  it('generate_image：声明派生的顶层字段（complexity）进请求体', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'openai:gpt-image-2.6-flare',
      prompt: '猫',
      complexity: 'low',
    })
    expect(captured[0]!.body.complexity).toBe('low')
  })

  it('同步平台不暴露 list_jobs，工具不声明与结果不符的 outputSchema', async () => {
    const { handlers } = handlersWith(imageJson)
    const tools = handlers.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain('list_jobs')
    for (const name of ['chat', 'generate_image', 'get_tool_help', 'list_capabilities'])
      expect(tools.find((tool) => tool.name === name)?.outputSchema).toBeUndefined()
  })
})
