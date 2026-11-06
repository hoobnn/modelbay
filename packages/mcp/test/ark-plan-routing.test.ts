/**
 * 方舟 MCP 按渠道选适配器：`ark-plan:` 前缀与只配套餐 key 时走 /api/plan/v3，不悄悄按量计费。
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
  auth: string | null
}

function handlersWith(env: Record<string, string>) {
  const platform = platformOf('ark')
  const adapters = platform.createAdapters()
  const adapter = adapters.find((item) => item.channels.includes(platform.primaryChannel))!
  const captured: Captured[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
    if (String(url).includes('/chat/completions'))
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    return Response.json({ data: [{ b64_json: 'AAAA' }], usage: { generated_images: 1 } })
  }) as typeof fetch
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    adapters,
    ...(platform.channelSecrets ? { channelSecrets: platform.channelSecrets } : {}),
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, env),
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

const BOTH = { ARK_API_KEY: 'api-key', ARK_AGENT_PLAN_API_KEY: 'plan-key' }

describe('方舟 MCP 按渠道路由', () => {
  it('只配套餐 key、不传模型：走套餐', async () => {
    const { handlers, captured } = handlersWith({ ARK_AGENT_PLAN_API_KEY: 'plan-key' })
    const res = await handlers.callTool('generate_image', { prompt: '猫' })
    expect(res.isError).toBeFalsy()
    expect(captured[0]!.url).toContain('/api/plan/v3')
    expect(captured[0]!.auth).toBe('Bearer plan-key')
  })

  it('两个 key 都配：ark-plan: 前缀走套餐，ark: 前缀走按量', async () => {
    const plan = handlersWith(BOTH)
    await plan.handlers.callTool('generate_image', {
      model: 'ark-plan:doubao-seedream-5.0-pro',
      prompt: '猫',
    })
    expect(plan.captured[0]!.url).toContain('/api/plan/v3')
    expect(plan.captured[0]!.auth).toBe('Bearer plan-key')

    const api = handlersWith(BOTH)
    await api.handlers.callTool('generate_image', {
      model: 'ark:doubao-seedream-5-0-pro-260628',
      prompt: '猫',
    })
    expect(api.captured[0]!.url).not.toContain('/api/plan/')
    expect(api.captured[0]!.auth).toBe('Bearer api-key')
  })

  it('不带前缀的套餐专属模型走套餐', async () => {
    const { handlers, captured } = handlersWith(BOTH)
    const res = await handlers.callTool('chat', { model: 'kimi-k3', prompt: 'hi' })
    expect(res.isError).toBeFalsy()
    expect(captured[0]!.url).toContain('/api/plan/v3')
    expect(captured[0]!.auth).toBe('Bearer plan-key')
  })
})
