/**
 * 未传 model 与带渠道前缀的 model：用真实适配器 + 假 fetch 走完整的 tools/call 路径，
 * 确认路由层统一补默认模型、统一去掉 `渠道:` 前缀。
 */
import { readFileSync } from 'node:fs'
import { createAdapterContext } from '@modelbay/core'
import type { PlatformAdapter } from '@modelbay/core'
import { arkAdapter } from '@modelbay/ark'
import { bailianAdapter } from '@modelbay/bailian'
import { doubaoAdapter } from '@modelbay/doubao-speech'
import { describe, expect, it, vi } from 'vite-plus/test'
import { generateTools } from '../src/generate'
import { PLATFORMS } from '../src/platform'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS, type CallToolResult, type PlatformKey } from '../src/types'
import { fakeAdapter, fakeContext } from './fixtures'

function setup(platform: PlatformKey, adapter: PlatformAdapter, replies: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>(async () => replies.shift() ?? new Response('{}'))
  const meta = PLATFORMS[platform]
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      fetchImpl,
      secrets: Object.fromEntries(meta.keyEnvVars.map((key) => [key, 'secret'])),
      log: () => {},
    }),
    groups: MCP_TOOL_GROUPS.all,
    keyEnvVars: meta.keyEnvVars,
    primaryChannel: meta.primaryChannel,
    serverInfo: { name: 'test', version: '1.0.0' },
  })
  const bodyOf = (index = 0) =>
    JSON.parse(String((fetchImpl.mock.calls[index]![1] as RequestInit).body)) as Record<
      string,
      unknown
    >
  return { handlers, fetchImpl, bodyOf }
}

describe('豆包 text_to_speech 不传 model', () => {
  it('补主渠道的默认语音模型，请求发到 seed-tts-2.0', async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../doubao-speech/test/fixtures/tts-success.json', import.meta.url),
        'utf8',
      ),
    ) as { response: { status: number; headers: Record<string, string>; text: string } }
    const { handlers, fetchImpl, bodyOf } = setup('doubao-speech', doubaoAdapter, [
      new Response(fixture.response.text, {
        status: fixture.response.status,
        headers: fixture.response.headers,
      }),
    ])
    const result = (await handlers.callTool('text_to_speech', {
      text: '你好',
      voice: 'zh_female_vv_uranus_bigtts',
    })) as CallToolResult
    expect(result.isError).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional')
    expect((init.headers as Record<string, string>)['X-Api-Resource-Id']).toBe('seed-tts-2.0')
    expect((bodyOf().req_params as { speaker: string }).speaker).toBe('zh_female_vv_uranus_bigtts')
  })
})

describe('百炼默认模型不带渠道前缀', () => {
  const imageReply = () =>
    Response.json({
      output: { choices: [{ message: { content: [{ image: 'https://example.com/a.png' }] } }] },
    })

  it('generate_image 不传 model：发给 API 的是 qwen-image-3.0-pro，且走 enable_thinking 分支', async () => {
    const { handlers, bodyOf } = setup('bailian', bailianAdapter, [imageReply()])
    const result = (await handlers.callTool('generate_image', {
      prompt: '一只猫',
      thinking: true,
    })) as CallToolResult
    expect(result.isError).toBeUndefined()
    const body = bodyOf()
    expect(body.model).toBe('qwen-image-3.0-pro')
    expect(body.parameters).toMatchObject({ enable_thinking: true })
    expect(body.parameters).not.toHaveProperty('thinking_mode')
  })

  it('显式传 bailian:qwen-image-3.0-pro 与不传效果一致', async () => {
    const { handlers, bodyOf } = setup('bailian', bailianAdapter, [imageReply()])
    await handlers.callTool('generate_image', {
      prompt: '一只猫',
      thinking: true,
      model: 'bailian:qwen-image-3.0-pro',
    })
    expect(bodyOf().model).toBe('qwen-image-3.0-pro')
    expect(bodyOf().parameters).toMatchObject({ enable_thinking: true })
  })
})

describe('渠道前缀的剥离范围', () => {
  it('只去掉适配器自己渠道的前缀，其他渠道的前缀原样交给适配器', async () => {
    const { adapter, calls } = fakeAdapter()
    const handlers = createHandlers({
      set: generateTools('ark', { adapter }),
      adapter,
      context: fakeContext({ ARK_API_KEY: 'k' }),
      groups: MCP_TOOL_GROUPS.all,
      keyEnvVars: PLATFORMS.ark.keyEnvVars,
      primaryChannel: 'ark',
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    await handlers.callTool('chat', { prompt: 'x', model: 'ark:chat-pro' })
    await handlers.callTool('chat', { prompt: 'x', model: 'ark-plan:chat-pro' })
    await handlers.callTool('chat', { prompt: 'x' })
    expect(calls.submit.map((item) => (item as { model: string }).model)).toEqual([
      'chat-pro',
      'ark-plan:chat-pro',
      'chat-pro',
    ])
  })
})

describe('方舟 seed 参数', () => {
  const videoReply = () => Response.json({ id: 'cgt-1' })

  it('generate_video 的 seed 为 null（schema 默认值）时不当作显式参数', async () => {
    const { handlers, fetchImpl, bodyOf } = setup('ark', arkAdapter, [videoReply()])
    const result = (await handlers.callTool('generate_video', {
      prompt: '海浪',
      seed: null,
    })) as CallToolResult
    expect(result.isError).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf()).not.toHaveProperty('seed')
  })

  it('默认模型不支持 seed 时，传整数得到中文说明且不联网', async () => {
    const { handlers, fetchImpl } = setup('ark', arkAdapter, [])
    await expect(handlers.callTool('generate_video', { prompt: '海浪', seed: 7 })).rejects.toThrow(
      /不支持 seed 参数，请去掉 seed/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(handlers.callTool('generate_image', { prompt: '猫', seed: 7 })).rejects.toThrow(
      /不支持 seed 参数，请去掉 seed/,
    )
  })

  it('工具说明注明 seed 仅部分模型支持', () => {
    const tool = generateTools('ark', { adapter: arkAdapter }).byName.get('generate_video')!
    expect(JSON.stringify(tool.inputSchema.properties?.seed)).toContain('仅部分模型支持')
  })
})

describe('百炼 text_to_speech 说明与适配器行为一致', () => {
  const tool = generateTools('bailian', { adapter: bailianAdapter }).byName.get('text_to_speech')!

  it('不再声称自动分段拼接、保存 wav 或按音色前缀推断模型', () => {
    expect(tool.description).not.toContain('自动按句切成')
    expect(tool.description).not.toContain('按音色 ID 前缀')
    expect(tool.description).toContain('不超过 250 字符')
  })

  it('cosyvoice-v2 不支持指令：说明与适配器报错一致', async () => {
    expect(tool.description).toContain(
      'cosyvoice-v2、cosyvoice-v3-plus 与 qwen3-tts-flash 传了会直接报错',
    )
    const { handlers, fetchImpl } = setup('bailian', bailianAdapter, [])
    await expect(
      handlers.callTool('text_to_speech', {
        text: '你好',
        voice: 'longanyang',
        model: 'cosyvoice-v2',
        instructions: '温柔一点',
      }),
    ).rejects.toThrow(/不支持语气指令/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('parameters 合并进 input 对象（CosyVoice 的 language_hints）', async () => {
    const { handlers, bodyOf } = setup('bailian', bailianAdapter, [
      Response.json({ output: { audio: { url: 'https://example.com/a.wav' } } }),
    ])
    await handlers.callTool('text_to_speech', {
      text: '你好',
      voice: 'longanyang',
      model: 'cosyvoice-v3-flash',
      parameters: { language_hints: ['zh'] },
    })
    expect((bodyOf().input as Record<string, unknown>).language_hints).toEqual(['zh'])
  })
})
