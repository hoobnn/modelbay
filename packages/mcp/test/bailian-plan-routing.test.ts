/**
 * 百炼 MCP 按渠道选适配器：`bailian-plan:` 前缀、只在套餐里的模型、只配套餐 key 时走 Token Plan。
 */
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { effectiveChannel } from '../src/launch'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

const PLAN = 'https://token-plan.cn-beijing.maas.aliyuncs.com/'

function handlersWith(env: Record<string, string>) {
  const platform = platformOf('bailian')
  const adapters = platform.createAdapters()
  const adapter = adapters.find((item) => item.channels.includes(platform.primaryChannel))!
  const captured: Array<{ url: string; auth: string | null; model: unknown }> = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      auth: new Headers(init?.headers).get('authorization'),
      model: JSON.parse(String(init?.body ?? '{}')).model,
    })
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as typeof fetch
  const channel = effectiveChannel(platform, (name) => Boolean(env[name]))
  const handlers = createHandlers({
    set: generateTools(platform, { adapter, channel }),
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
    primaryChannel: channel,
    serverInfo: { name: 'test', version: '0.0.0' },
  })
  return { handlers, captured }
}

const BOTH = { BAILIAN_API_KEY: 'api-key', BAILIAN_TOKEN_PLAN_API_KEY: 'plan-key' }

describe('百炼 MCP 按渠道路由', () => {
  it('按量 key 用别名 DASHSCOPE_API_KEY 时，不带模型仍走按量', async () => {
    const { handlers, captured } = handlersWith({
      DASHSCOPE_API_KEY: 'api-key',
      BAILIAN_TOKEN_PLAN_API_KEY: 'plan-key',
    })
    await handlers.callTool('chat', { prompt: '你好' })
    expect(captured[0]!.auth).toBe('Bearer api-key')
  })

  it('只配套餐 key、不传模型：走 Token Plan 的默认对话模型', async () => {
    const { handlers, captured } = handlersWith({ BAILIAN_TOKEN_PLAN_API_KEY: 'plan-key' })
    const res = await handlers.callTool('chat', { prompt: '你好' })
    expect(res.isError).toBeFalsy()
    expect(captured[0]).toMatchObject({ auth: 'Bearer plan-key', model: 'qwen3.8-max' })
    expect(captured[0]!.url.startsWith(PLAN)).toBe(true)
  })

  it('两个 key 都配：套餐独有模型与 bailian-plan: 前缀走套餐，其余走按量', async () => {
    const preview = handlersWith(BOTH)
    await preview.handlers.callTool('chat', { prompt: '你好', model: 'qwen4-max-preview' })
    expect(preview.captured[0]!.url.startsWith(PLAN)).toBe(true)

    // 官方别名同样按声明找渠道
    const alias = handlersWith(BOTH)
    await alias.handlers.callTool('chat', { prompt: '你好', model: 'qwen4.0-max-preview' })
    expect(alias.captured[0]).toMatchObject({ auth: 'Bearer plan-key', model: 'qwen4-max-preview' })

    const prefixed = handlersWith(BOTH)
    await prefixed.handlers.callTool('chat', { prompt: '你好', model: 'bailian-plan:qwen3.8-max' })
    expect(prefixed.captured[0]).toMatchObject({ auth: 'Bearer plan-key', model: 'qwen3.8-max' })

    const api = handlersWith(BOTH)
    await api.handlers.callTool('chat', { prompt: '你好', model: 'qwen3.8-max' })
    expect(api.captured[0]!.url.startsWith(PLAN)).toBe(false)
    expect(api.captured[0]!.auth).toBe('Bearer api-key')
  })
})
