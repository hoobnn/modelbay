/**
 * MCP → 真实 MiniMax 适配器（注入 fetch，不联网）：
 * 断言每个已映射的工具参数都进了上游请求，改走 native 的工具能真正执行。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  method: string
  body: Record<string, unknown>
  form?: FormData
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const ok = { base_resp: { status_code: 0 } }

function setup(reply: (url: string, method: string) => Response) {
  const platform = platformOf('minimax')
  const adapter = platform.createAdapters()[0]!
  const captured: Captured[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    const form = init?.body instanceof FormData ? init.body : undefined
    captured.push({ url: String(url), method: init?.method ?? 'GET', body, form })
    return reply(String(url), init?.method ?? 'GET')
  }) as typeof fetch
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, { MINIMAX_API_KEY: 'k' }),
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

const bodyOf = (captured: Captured[], path: string) =>
  captured.find((c) => c.url.includes(path))?.body

describe('MCP MiniMax 参数进上游请求', () => {
  it('text_to_speech：音色与音频参数写入 voice_setting / audio_setting', async () => {
    const { handlers, captured } = setup(() => json({ ...ok, data: { audio: '0102' } }))
    const result = await handlers.callTool('text_to_speech', {
      text: '你好',
      voice_id: 'v1',
      speed: 1.2,
      vol: 2,
      pitch: 3,
      emotion: 'happy',
      sample_rate: 24000,
      bitrate: 64000,
      channel: 2,
      format: 'wav',
      language_boost: 'Chinese',
    })
    expect(result.isError).toBeFalsy()
    const body = bodyOf(captured, '/v1/t2a_v2')!
    expect(body.voice_setting).toEqual({
      voice_id: 'v1',
      speed: 1.2,
      vol: 2,
      pitch: 3,
      emotion: 'happy',
    })
    expect(body.audio_setting).toEqual({
      format: 'wav',
      sample_rate: 24000,
      bitrate: 64000,
      channel: 2,
    })
    expect(body.language_boost).toBe('Chinese')
  })

  it('已归档的模型：工具不再提供，显式点名也不发请求', async () => {
    const { handlers, captured } = setup(() => json(ok))
    const names = (await handlers.listTools()).map((tool) => tool.name)
    expect(names).not.toContain('music_generation')
    const music = await handlers.callTool('music_generation', { model: 'music-3.0' })
    expect(music.isError).toBe(true)
    const video = await handlers.callTool('generate_video', {
      model: 'MiniMax-M2.7',
      prompt: '海边',
    })
    expect(video.isError).toBe(true)
    expect(JSON.stringify(video.content)).toContain('已归档')
    expect(captured).toHaveLength(0)
  })

  it('generate_image：prompt_optimizer / parameters / subject_reference / n / aspect_ratio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-'))
    const face = join(dir, 'face.png')
    writeFileSync(face, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    const { handlers, captured } = setup(() =>
      json({ ...ok, data: { image_urls: ['https://example.com/a.jpg'] } }),
    )
    await handlers.callTool('generate_image', {
      prompt: '人像',
      model: 'image-01',
      aspect_ratio: '16:9',
      n: 2,
      prompt_optimizer: true,
      subject_reference: face,
      parameters: { aigc_watermark: true, seed: 7 },
    })
    const body = bodyOf(captured, '/v1/image_generation')!
    expect(body).toMatchObject({
      model: 'image-01',
      n: 2,
      aspect_ratio: '16:9',
      prompt_optimizer: true,
      aigc_watermark: true,
      seed: 7,
    })
    const reference = (body.subject_reference as Array<Record<string, string>>)[0]!
    expect(reference.type).toBe('character')
    expect(reference.image_file).toMatch(/^data:image\/png;base64,/)
  })

  it('generate_image：image-01-live 的 style 对象', async () => {
    const { handlers, captured } = setup(() =>
      json({ ...ok, data: { image_urls: ['https://example.com/a.jpg'] } }),
    )
    await handlers.callTool('generate_image', {
      prompt: 'x',
      model: 'image-01-live',
      parameters: { style: { style_type: '水彩', style_weight: 0.5 } },
    })
    expect(bodyOf(captured, '/v1/image_generation')!.style).toEqual({
      style_type: '水彩',
      style_weight: 0.5,
    })
  })

  it('generate_video：parameters 的 callback_url / aigc_watermark 与画幅时长', async () => {
    const { handlers, captured } = setup((url) =>
      url.includes('/v2/video_generation') ? json({ task_id: '123' }) : new Response('x'),
    )
    const result = await handlers.callTool('generate_video', {
      prompt: '海边',
      duration: 5,
      ratio: '16:9',
      parameters: { callback_url: 'https://example.com/cb', aigc_watermark: true },
    })
    const body = bodyOf(captured, '/v2/video_generation')
    expect(body).toMatchObject({
      callback_url: 'https://example.com/cb',
      aigc_watermark: true,
      duration: 5,
    })
    expect(body!.ratio).toBe('16:9')
    expect(JSON.stringify(result)).toContain('123')
  })

  it('generate_video：本地首帧经 assets 读取，缺宽高元数据也不拒绝', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-'))
    const frame = join(dir, 'frame.png')
    writeFileSync(frame, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))
    const { handlers, captured } = setup((url) =>
      url.includes('/v2/video_generation') ? json({ task_id: '7' }) : new Response('x'),
    )
    const result = await handlers.callTool('generate_video', { prompt: '海边', first_frame: frame })
    expect(result.isError).toBeFalsy()
    const content = bodyOf(captured, '/v2/video_generation')!.content as Array<{ role?: string }>
    expect(content.some((item) => item.role === 'first_frame')).toBe(true)
  })

  it('generate_video 不再声明 content', () => {
    const set = generateTools(platformOf('minimax'))
    const props = set.byName.get('generate_video')!.inputSchema.properties!
    expect(props.content).toBeUndefined()
    expect(set.byName.has('query_video_generation')).toBe(false)
  })
})

describe('MCP MiniMax native 工具', () => {
  it('create_h3_context_ir_task：prompt / duration / ratio / callback_url', async () => {
    const { handlers, captured } = setup(() => json({ task_id: '9' }))
    await handlers.callTool('create_h3_context_ir_task', {
      prompt: '雨夜',
      duration: 6,
      ratio: '9:16',
      parameters: { callback_url: 'https://example.com/cb' },
    })
    expect(bodyOf(captured, '/v2/h3_context_ir')).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '雨夜' }],
      duration: 6,
      ratio: '9:16',
      callback_url: 'https://example.com/cb',
    })
  })

  it('get_job 能轮询 context-ir 任务并返回增强提示词文本', async () => {
    const { handlers } = setup(() =>
      json({
        task: {
          id: '9',
          status: 'succeeded',
          task_type: 'h3_context_ir',
          content: { prompt: '增强后的提示词' },
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        },
      }),
    )
    const result = await handlers.callTool('get_job', { task_id: '9' })
    expect(result.isError).toBeFalsy()
    expect(JSON.stringify(result.structuredContent)).toContain('增强后的提示词')
  })

  it('regenerate_video：source_task_id 与 callback_url', async () => {
    const { handlers, captured } = setup(() => json({ task_id: '5' }))
    await handlers.callTool('regenerate_video', {
      source_task_id: 'src-1',
      parameters: { aigc_watermark: true },
    })
    expect(bodyOf(captured, '/v2/video_regeneration')).toMatchObject({
      model: 'MiniMax-H3',
      source_task_id: 'src-1',
      aigc_watermark: true,
    })
  })

  it('delete_video_task：DELETE /v2/video_generation/{id}', async () => {
    const { handlers, captured } = setup(() =>
      json({ task_id: '77', action: 'deleted', status: 'deleted' }),
    )
    const result = await handlers.callTool('delete_video_task', { task_id: '77' })
    expect(result.isError).toBeFalsy()
    expect(captured[0]).toMatchObject({ method: 'DELETE' })
    expect(captured[0]!.url).toContain('/v2/video_generation/77')
  })

  it('list_video_tasks：分页与 filter.* 查询参数', async () => {
    const { handlers, captured } = setup(() => json({ items: [], total: 0 }))
    await handlers.callTool('list_video_tasks', {
      page_num: 2,
      page_size: 10,
      status: 'succeeded',
      task_type: 'regeneration',
      model: 'MiniMax-H3',
    })
    const url = new URL(captured[0]!.url)
    expect(url.pathname).toBe('/v2/query/video_generation')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page_num: '2',
      page_size: '10',
      'filter.status': 'succeeded',
      'filter.task_type': 'regeneration',
      'filter.model': 'MiniMax-H3',
    })
  })

  it('upload_file：本地文件走 multipart，purpose 生效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-'))
    const file = join(dir, 'a.png')
    writeFileSync(file, new Uint8Array([137, 80, 78, 71]))
    const { handlers, captured } = setup(() => json({ ...ok, file: { file_id: 42 } }))
    const result = await handlers.callTool('upload_file', {
      file,
      purpose: 'video_generation_input',
    })
    expect(result.isError).toBeFalsy()
    expect(captured[0]!.url).toContain('/v1/files/upload')
    expect(captured[0]!.form!.get('purpose')).toBe('video_generation_input')
    expect(captured[0]!.form!.get('file')).toBeInstanceOf(Blob)
    expect(JSON.stringify(result.structuredContent)).toContain('42')
  })

  it('clone_voice：改走 voice-clone，先上传样本再复刻，试听 text 与 model 生效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-'))
    const file = join(dir, 'sample.wav')
    writeFileSync(file, new Uint8Array([82, 73, 70, 70]))
    const { handlers, captured } = setup((url) =>
      url.includes('/v1/files/upload') ? json({ ...ok, file: { file_id: 42 } }) : json(ok),
    )
    const result = await handlers.callTool('clone_voice', {
      voice_id: 'MyVoice_12345',
      file,
      text: '试听',
      model: 'minimax:speech-2.8-hd',
    })
    expect(result.isError).toBeFalsy()
    expect(captured[0]!.url).toContain('/v1/files/upload')
    expect(captured[0]!.form!.get('purpose')).toBe('voice_clone')
    expect(bodyOf(captured, '/v1/voice_clone')).toEqual({
      file_id: 42,
      voice_id: 'MyVoice_12345',
      need_noise_reduction: false,
      need_volume_normalization: false,
      text: '试听',
      model: 'speech-2.8-hd',
    })
  })

  it('clone_voice：已上传的 file_id 直接用，不再上传', async () => {
    const { handlers, captured } = setup(() => json(ok))
    await handlers.callTool('clone_voice', { voice_id: 'MyVoice_12345', file_id: '99' })
    expect(captured).toHaveLength(1)
    expect(bodyOf(captured, '/v1/voice_clone')).toMatchObject({ file_id: 99 })
  })

  it('design_voice：改走 voice-design，prompt / preview_text / voice_id 进请求体', async () => {
    const { handlers, captured } = setup(() =>
      json({ ...ok, voice_id: 'Designed_1', trial_audio: '0102' }),
    )
    const result = await handlers.callTool('design_voice', {
      prompt: '温柔的女声',
      preview_text: '你好',
      voice_id: 'Designed_1',
    })
    expect(result.isError).toBeFalsy()
    expect(bodyOf(captured, '/v1/voice_design')).toEqual({
      voice_id: 'Designed_1',
      prompt: '温柔的女声',
      preview_text: '你好',
    })
  })

  it('design_voice：不传 voice_id 时请求体不带该字段', async () => {
    const { handlers, captured } = setup(() =>
      json({ ...ok, voice_id: 'Auto_1', trial_audio: '0102' }),
    )
    const result = await handlers.callTool('design_voice', {
      prompt: '温柔的女声',
      preview_text: '你好',
    })
    expect(result.isError).toBeFalsy()
    expect(bodyOf(captured, '/v1/voice_design')).toEqual({
      prompt: '温柔的女声',
      preview_text: '你好',
    })
  })
})
