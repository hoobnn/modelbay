/**
 * 方舟 MCP 工具 → 真实适配器（注入 fetch，不联网）：
 * 断言需要平台换算的参数确实落进上游请求体（thinking、size、fast、watermark 等）。
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
  const platform = platformOf('ark')
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
      secrets: readSecrets(platform.secrets, { ARK_API_KEY: 'k' }),
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

const chatSse = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const imageJson = () =>
  Response.json({ data: [{ b64_json: 'AAAA' }], usage: { generated_images: 1 } })

describe('MCP 方舟工具经真实适配器', () => {
  it('chat：thinking 布尔值换成 thinking.type，parameters 进请求体', async () => {
    const { handlers, captured } = handlersWith(chatSse)
    for (const [thinking, type] of [
      [true, 'enabled'],
      [false, 'disabled'],
    ] as const) {
      await handlers.callTool('chat', {
        model: 'ark:doubao-seed-2-1-lite-260915',
        prompt: 'hi',
        thinking,
        parameters: { top_p: 0.5 },
      })
      expect(captured.at(-1)!.body.thinking).toEqual({ type })
      expect(captured.at(-1)!.body.top_p).toBe(0.5)
    }
  })

  it('chat：白名单外的 parameters 报错而不是静默忽略', async () => {
    const { handlers } = handlersWith(chatSse)
    await expect(
      handlers.callTool('chat', {
        model: 'ark:doubao-seed-2-1-lite-260915',
        prompt: 'hi',
        parameters: { web_search: true },
      }),
    ).rejects.toThrow(/web_search/)
  })

  it('generate_image：size 档位、output_format、watermark、fast 都进请求体', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'ark:doubao-seedream-5-0-pro-260628',
      prompt: '猫',
      size: '1K',
      output_format: 'png',
      watermark: true,
      fast: true,
    })
    expect(captured[0]!.body).toMatchObject({
      size: expect.stringMatching(/^\d+x\d+$/),
      output_format: 'png',
      watermark: true,
      optimize_prompt_options: { mode: 'fast' },
    })
  })

  it('generate_image：宽x高像素原样作为 size', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'ark:doubao-seedream-5-0-pro-260628',
      prompt: '猫',
      size: '1536x1024',
    })
    expect(captured[0]!.body.size).toBe('1536x1024')
  })

  it('generate_video：watermark、draft、return_last_frame、service_tier 与 audio 进请求体', async () => {
    const { handlers, captured } = handlersWith(() => Response.json({ id: 'cgt-1' }))
    await handlers.callTool('generate_video', {
      model: 'ark:doubao-seedance-2-5-260628',
      prompt: '日出',
      resolution: '480p',
      audio: false,
      watermark: true,
      draft: true,
      return_last_frame: true,
      parameters: { service_tier: 'default' },
    })
    expect(captured[0]!.body).toMatchObject({
      generate_audio: false,
      watermark: true,
      draft: true,
      return_last_frame: true,
      service_tier: 'default',
    })
  })
})
