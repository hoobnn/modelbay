/**
 * MCP → 真实平台适配器的端到端测试（注入 fetch，不联网）。
 * 其余 MCP 测试用假适配器，测不出「工具参数名」和「适配器读的归一化字段」对不上；
 * 这里断言 MCP 参数真的落到了上游请求体里，字节结果按 MCP 标准内容块返回。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { normalizeArguments } from '../src/arguments'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  body: Record<string, unknown>
}

function handlersWith(key: string, env: Record<string, string>, reply: (url: string) => Response) {
  const platform = platformOf(key)
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

const chatSse = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"2"},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

describe('MCP chat 经真实适配器', () => {
  for (const [key, env, model] of [
    ['bailian', { BAILIAN_API_KEY: 'k' }, 'bailian:qwen3.8-flash'],
    ['ark', { ARK_API_KEY: 'k' }, 'ark:doubao-seed-2-1-lite-260915'],
  ] as const) {
    it(`${key}：system / history / prompt 拼成 messages，max_tokens 生效`, async () => {
      const { handlers, captured } = handlersWith(key, env, chatSse)
      const result = await handlers.callTool('chat', {
        model,
        system: '只回答数字',
        history: [
          { role: 'user', content: '1+1' },
          { role: 'assistant', content: '2' },
        ],
        prompt: '2+2',
        max_tokens: 16,
        thinking: null,
      })
      expect(result.isError).toBeFalsy()
      expect(captured[0]!.body.messages).toEqual([
        { role: 'system', content: '只回答数字' },
        { role: 'user', content: '1+1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '2+2' },
      ])
      expect(captured[0]!.body.max_tokens).toBe(16)
      expect(result.content[0].text).toContain('"2"')
    })
  }
})

describe('MCP text_to_speech 经真实适配器', () => {
  it('minimax：voice_id 落到 voice_setting，音频按 MCP audio 块返回', async () => {
    const { handlers, captured } = handlersWith('minimax', { MINIMAX_API_KEY: 'k' }, () =>
      Response.json({ base_resp: { status_code: 0 }, data: { audio: '494433' } }),
    )
    const result = await handlers.callTool('text_to_speech', {
      text: '你好',
      voice_id: 'female-shaonv',
      model: 'minimax:speech-2.8-turbo',
    })
    expect(result.isError).toBeFalsy()
    expect((captured[0]!.body.voice_setting as { voice_id: string }).voice_id).toBe('female-shaonv')
    expect(result.content[1]).toEqual({ type: 'audio', mimeType: 'audio/mpeg', data: 'SUQz' })
    expect(result.content[0].text).not.toMatch(/"0":\s*73/)
    expect(result.content[0].text).toContain('"bytes": 3')
  })
})

const dir = mkdtempSync(join(tmpdir(), 'modelbay-mcp-'))
const png = join(dir, 'frame.png')
writeFileSync(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]))

describe('MCP 素材参数经真实适配器', () => {
  it('bailian chat：images 的本地图片读成 data URL，跟 prompt 放进同一条 user 消息', async () => {
    const { handlers, captured } = handlersWith('bailian', { BAILIAN_API_KEY: 'k' }, chatSse)
    const result = await handlers.callTool('chat', {
      model: 'bailian:qwen3.8-flash',
      prompt: '图里是什么',
      images: [png],
    })
    expect(result.isError).toBeFalsy()
    const messages = captured[0]!.body.messages as Array<{ role: string; content: unknown }>
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: '图里是什么' },
        {
          type: 'image_url',
          image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        },
      ],
    })
  })

  it('ark generate_video：首帧进 content，返回 job_id；get_job 轮询完成后下载到 out_dir', async () => {
    const { handlers, captured } = handlersWith('ark', { ARK_API_KEY: 'k' }, (url) => {
      if (url.endsWith('/contents/generations/tasks')) return Response.json({ id: 'cgt-1' })
      if (url.endsWith('/contents/generations/tasks/cgt-1'))
        return Response.json({
          status: 'succeeded',
          content: {
            video_url: 'https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/v.mp4',
          },
          duration: 5,
        })
      return new Response(Uint8Array.from([0, 0, 0, 8]), {
        headers: { 'Content-Type': 'video/mp4' },
      })
    })
    const submitted = await handlers.callTool('generate_video', {
      prompt: '日出',
      model: 'ark:doubao-seedance-2-5-260628',
      first_frame: png,
      out_dir: join(dir, 'out'),
    })
    expect(submitted.isError).toBeFalsy()
    expect(submitted.structuredContent).toMatchObject({ job_id: 'cgt-1', job_state: 'running' })
    const content = captured[0]!.body.content as Array<Record<string, unknown>>
    expect(content.find((item) => item.role === 'first_frame')).toMatchObject({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
    })

    const job = await handlers.callTool('get_job', { task_id: 'cgt-1' })
    const view = job.structuredContent as { job_state: string; outputs: Array<{ path: string }> }
    expect(view.job_state).toBe('delivered')
    expect(readFileSync(view.outputs[0]!.path)).toEqual(Buffer.from([0, 0, 0, 8]))
    expect(view.outputs[0]!.path.startsWith(join(dir, 'out'))).toBe(true)

    const listed = await handlers.callTool('list_jobs', {})
    expect(listed.structuredContent).toMatchObject({
      jobs: [{ id: 'cgt-1', tool: 'generate_video', state: 'delivered' }],
    })
  })

  it('素材来源读 data URL 和本地路径，找不到文件时报 invalid_input', async () => {
    const source = createMcpAssetSource({ cwd: dir })
    expect(await source.load('data:text/plain;base64,aGk=')).toMatchObject({ mime: 'text/plain' })
    expect((await source.load('frame.png')).mime).toBe('image/png')
    await expect(source.load('missing.png')).rejects.toThrow(/找不到素材文件/)
  })
})

describe('normalizeArguments', () => {
  it('只补缺失的归一化字段，原字段保留', () => {
    expect(
      normalizeArguments('text.chat', { messages: [{ role: 'user', content: 'x' }], prompt: 'y' }),
    ).toMatchObject({ messages: [{ role: 'user', content: 'x' }], prompt: 'y' })
    expect(normalizeArguments('audio.speech', { voice: 'a', voice_id: 'b' }).voice).toBe('a')
    expect(normalizeArguments('audio.speech', { instructions: '温柔' }).instruction).toBe('温柔')
    expect(normalizeArguments('image.generate', { negative_prompt: 'n', n: 2 })).toMatchObject({
      negativePrompt: 'n',
      count: 2,
    })
    expect(normalizeArguments('video.generate', { ratio: '16:9' }).aspectRatio).toBe('16:9')
    expect(
      normalizeArguments('video.generate', {
        reference_images: ['a.png'],
        reference_videos: ['https://x/v.mp4'],
        reference_audios: ['b.mp3'],
      }).references,
    ).toEqual([
      { assetId: 'a.png', kind: 'image', mime: 'image/png' },
      { assetId: 'https://x/v.mp4', kind: 'video', mime: 'video/mp4' },
      { assetId: 'b.mp3', kind: 'audio', mime: 'audio/mpeg' },
    ])
    expect(normalizeArguments('audio.transcribe', { audio: 'a.wav' }).audio).toMatchObject({
      assetId: 'a.wav',
      kind: 'audio',
    })
    expect(normalizeArguments('text.embed', { texts: ['a'] })).toEqual({ texts: ['a'] })
  })

  it('history 形状不对时报 invalid_input', () => {
    expect(() => normalizeArguments('text.chat', { history: 'x', prompt: 'y' })).toThrow(/history/)
    expect(() => normalizeArguments('text.chat', { history: [{ content: 'x' }] })).toThrow(/role/)
  })
})
