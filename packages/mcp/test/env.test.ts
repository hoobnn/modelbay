/**
 * 鉴权命名回归测试：MCP 只按平台描述对象里声明的密钥名（含别名）从环境读 key，
 * 注入 ctx.secret('<名字>')；不打印 key 值；未配置时返回清晰错误。
 */
import { createAdapterContext, missingSecrets, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS, type CallToolResult } from '../src/types'
import { fakeAdapter, MCP_KEYS, type McpKey, platformOf } from './fixtures'

const CANONICAL: Record<McpKey, readonly string[]> = {
  ark: ['ARK_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  bailian: ['BAILIAN_API_KEY'],
  'doubao-speech': ['DOUBAO_API_KEY'],
}

describe('MCP 命令鉴权环境变量名（团队统一规范）', () => {
  it('各平台第一组必填密钥就是规范名', () => {
    for (const platform of MCP_KEYS) {
      expect([...(platformOf(platform).secrets.required[0] ?? [])]).toEqual([
        ...CANONICAL[platform],
      ])
    }
  })

  it('别名也算已配置：百炼 DASHSCOPE_API_KEY、豆包语音旧版 APP ID + Token', () => {
    const bailian = platformOf('bailian').secrets
    const env = readSecrets(bailian, { DASHSCOPE_API_KEY: 'k' })
    expect(missingSecrets(bailian, (name) => Boolean(env[name]))).toEqual([])
    const doubao = platformOf('doubao-speech').secrets
    const legacy = readSecrets(doubao, { VOLC_SPEECH_APP_ID: 'a', VOLC_SPEECH_ACCESS_TOKEN: 't' })
    expect(missingSecrets(doubao, (name) => Boolean(legacy[name]))).toEqual([])
    expect(missingSecrets(doubao, () => false)).toEqual(['DOUBAO_API_KEY'])
  })

  it('readSecrets 只取平台声明的名字，忽略其它环境变量', () => {
    for (const platform of MCP_KEYS) {
      const env: Record<string, string | undefined> = { PATH: '/usr/bin', SOME_OTHER_KEY: 'nope' }
      for (const name of CANONICAL[platform]) env[name] = `value-${name}`
      const secrets = readSecrets(platformOf(platform).secrets, env)
      expect(Object.keys(secrets).sort()).toEqual([...CANONICAL[platform]].sort())
      for (const name of CANONICAL[platform]) {
        expect(secrets[name]).toBe(`value-${name}`)
      }
      expect(secrets.SOME_OTHER_KEY).toBeUndefined()
      expect(secrets.PATH).toBeUndefined()
    }
  })

  it('空值 / 未设置的 key 视为未配置', () => {
    const secrets = readSecrets(platformOf('ark').secrets, { ARK_API_KEY: '' })
    expect(secrets).toEqual({})
    expect(readSecrets(platformOf('ark').secrets, {})).toEqual({})
  })

  it('createAdapterContext 能按规范名取到 key', () => {
    for (const platform of MCP_KEYS) {
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
      secrets: platformOf('ark').secrets,
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
      secrets: platformOf('doubao-speech').secrets,
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
      secrets: platformOf('ark').secrets,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    const result = (await handlers.callTool('chat', { prompt: 'x' })) as CallToolResult
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).not.toContain('未配置访问密钥')
    expect(calls.submit).toHaveLength(1)
  })
})
