/**
 * M4 鉴权命名规范回归测试：四个 MCP 命令只按规范名从环境读 key，
 * 注入 ctx.secret('<规范名>')；不打印 key 值；未配置时返回清晰错误。
 */
import { createAdapterContext } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { collectSecrets } from '../src/launch'
import { PLATFORMS } from '../src/platform'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS, PLATFORM_KEYS, type CallToolResult, type PlatformKey } from '../src/types'
import { fakeAdapter } from './fixtures'

const CANONICAL: Record<PlatformKey, readonly string[]> = {
  ark: ['ARK_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  bailian: ['BAILIAN_API_KEY'],
  'doubao-speech': ['DOUBAO_APP_ID', 'DOUBAO_ACCESS_TOKEN'],
}

describe('MCP 命令鉴权环境变量名（团队统一规范）', () => {
  it('四个平台声明的 keyEnvVars 与规范名完全一致', () => {
    for (const platform of PLATFORM_KEYS) {
      expect([...PLATFORMS[platform].keyEnvVars]).toEqual([...CANONICAL[platform]])
    }
  })

  it('collectSecrets 只按规范名取 key，忽略其它环境变量', () => {
    for (const platform of PLATFORM_KEYS) {
      const env: Record<string, string | undefined> = { PATH: '/usr/bin', SOME_OTHER_KEY: 'nope' }
      for (const name of CANONICAL[platform]) env[name] = `value-${name}`
      const secrets = collectSecrets(PLATFORMS[platform], env)
      expect(Object.keys(secrets).sort()).toEqual([...CANONICAL[platform]].sort())
      for (const name of CANONICAL[platform]) {
        expect(secrets[name]).toBe(`value-${name}`)
      }
      expect(secrets.SOME_OTHER_KEY).toBeUndefined()
      expect(secrets.PATH).toBeUndefined()
    }
  })

  it('空值 / 未设置的 key 视为未配置', () => {
    const secrets = collectSecrets(PLATFORMS.ark, { ARK_API_KEY: '' })
    expect(secrets).toEqual({})
    expect(collectSecrets(PLATFORMS.ark, {})).toEqual({})
  })

  it('createAdapterContext 能按规范名取到 key', () => {
    for (const platform of PLATFORM_KEYS) {
      const names = CANONICAL[platform]
      const secrets = Object.fromEntries(names.map((name) => [name, `secret-${name}`]))
      const context = createAdapterContext({ secrets, log: () => {} })
      for (const name of names) expect(context.secret(name)).toBe(`secret-${name}`)
      expect(context.secret('NOT_A_KEY')).toBeUndefined()
    }
  })

  it('未配置 key 时错误信息只含规范名，不含任何 key 值', async () => {
    const { adapter } = fakeAdapter()
    const set = generateTools('ark', { adapter })
    const handlers = createHandlers({
      set,
      adapter,
      context: createAdapterContext({ secrets: {}, log: () => {} }),
      groups: MCP_TOOL_GROUPS.all,
      keyEnvVars: PLATFORMS.ark.keyEnvVars,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    const result = (await handlers.callTool('chat', { prompt: 'x' })) as CallToolResult
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('ARK_API_KEY')
    expect(result.content[0]?.text).not.toContain('secret-')
  })

  it('日志里只出现缺失 key 的名字，不出现已配置 key 的值', async () => {
    const secretValue = 'SUPER_SECRET_VALUE'
    const logs: string[] = []
    const { adapter } = fakeAdapter()
    const set = generateTools('doubao-speech', { adapter })
    const handlers = createHandlers({
      set,
      adapter,
      context: createAdapterContext({
        secrets: { DOUBAO_APP_ID: secretValue },
        log: (message, data) => logs.push(`${message} ${JSON.stringify(data ?? {})}`),
      }),
      groups: MCP_TOOL_GROUPS.all,
      keyEnvVars: PLATFORMS['doubao-speech'].keyEnvVars,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    const result = (await handlers.callTool('text_to_speech', { text: 'x' })) as CallToolResult
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('DOUBAO_ACCESS_TOKEN')
    expect(result.content[0]?.text).not.toContain(secretValue)
    expect(logs.join('\n')).not.toContain(secretValue)
  })

  it('配置了规范名 key 后 tools/call 正常路由，不再报未配置', async () => {
    const { adapter, calls } = fakeAdapter()
    const set = generateTools('ark', { adapter })
    const handlers = createHandlers({
      set,
      adapter,
      context: createAdapterContext({ secrets: { ARK_API_KEY: 'k' }, log: () => {} }),
      groups: MCP_TOOL_GROUPS.all,
      keyEnvVars: PLATFORMS.ark.keyEnvVars,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    const result = (await handlers.callTool('chat', { prompt: 'x' })) as CallToolResult
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).not.toContain('未配置访问密钥')
    expect(calls.submit).toHaveLength(1)
  })
})
