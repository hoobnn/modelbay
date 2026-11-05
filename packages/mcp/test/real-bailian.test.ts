/**
 * 百炼 MCP 工具经真实适配器（注入 fetch，不联网）：
 * 断言每个工具参数真的落到了上游请求体，重路由到 native 的工具走对了端点。
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

/** 请求体按需逐层断言，用宽松的递归类型避免到处断言。 */
// oxlint-disable-next-line typescript/no-explicit-any -- 请求体逐层断言，不值得为每层写类型
type Body = Record<string, any>

interface Captured {
  url: string
  body: Body
}

function handlersWith(reply: (url: string) => Response) {
  const platform = platformOf('bailian')
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
      secrets: readSecrets(platform.secrets, { BAILIAN_API_KEY: 'k' }),
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

/** 调用工具；上游回复不是重点，错误吞掉，只看发出的请求。 */
async function call(
  name: string,
  args: Record<string, unknown>,
  reply: (url: string) => Response = () => Response.json({ output: {} }),
) {
  const { handlers, captured } = handlersWith(reply)
  let error: unknown
  let result: Awaited<ReturnType<typeof handlers.callTool>> | undefined
  try {
    result = await handlers.callTool(name, args)
  } catch (cause) {
    error = cause
  }
  return { captured, error, result }
}

const chatSse = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const dir = mkdtempSync(join(tmpdir(), 'modelbay-bailian-'))
const wav = join(dir, 'a.wav')
writeFileSync(wav, Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]))
const png = join(dir, 'a.png')
writeFileSync(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))

describe('bailian chat', () => {
  it('thinking / thinking_budget / web_search / parameters 平铺进请求体顶层', async () => {
    const { captured, error } = await call(
      'chat',
      {
        model: 'bailian:qwen3.8-flash',
        prompt: 'hi',
        thinking: true,
        thinking_budget: 256,
        web_search: true,
        parameters: { top_p: 0.5 },
        max_tokens: 9,
        temperature: 0.2,
      },
      chatSse,
    )
    expect(error).toBeUndefined()
    const body = captured[0]!.body
    expect(body).toMatchObject({
      enable_thinking: true,
      thinking_budget: 256,
      enable_search: true,
      top_p: 0.5,
      max_tokens: 9,
      temperature: 0.2,
    })
  })

  it('json_mode 发 response_format=json_object', async () => {
    const { captured } = await call(
      'chat',
      { model: 'bailian:qwen3.8-flash', prompt: '给我 JSON', json_mode: true },
      chatSse,
    )
    expect(captured[0]!.body.response_format).toEqual({ type: 'json_object' })
  })
})

describe('bailian 重路由到 native', () => {
  it('embed：texts / dimensions 进兼容模式 embeddings', async () => {
    const { captured } = await call('embed', {
      model: 'bailian:text-embedding-v4',
      texts: ['猫'],
      dimensions: 512,
      parameters: { text_type: 'query' },
    })
    expect(captured[0]!.url).toContain('/compatible-mode/v1/embeddings')
    expect(captured[0]!.body).toMatchObject({
      model: 'text-embedding-v4',
      input: ['猫'],
      dimensions: 512,
      text_type: 'query',
    })
  })

  it('embed：contents 走多模态向量化', async () => {
    const { captured } = await call('embed', {
      model: 'qwen3-vl-embedding',
      contents: [{ text: '猫' }],
      dimensions: 256,
    })
    expect(captured[0]!.url).toContain('multimodal-embedding')
    expect(captured[0]!.body).toMatchObject({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '猫' }] },
      parameters: { dimension: 256 },
    })
  })

  it('rerank：query / documents / top_n / return_documents，模型去渠道前缀', async () => {
    const { captured } = await call('rerank', {
      model: 'bailian:qwen3.7-text-rerank',
      query: 'q',
      documents: ['a', 'b'],
      top_n: 1,
      return_documents: true,
    })
    expect(captured[0]!.url).toContain('text-rerank')
    expect(captured[0]!.body).toEqual({
      model: 'qwen3.7-text-rerank',
      input: { query: 'q', documents: ['a', 'b'] },
      parameters: { return_documents: true, top_n: 1 },
    })
  })

  it('speech_to_text：URL 原样，context / language / itn / parameters 生效', async () => {
    const { captured } = await call('speech_to_text', {
      audio: 'https://example.com/a.wav',
      context: '术语',
      language: 'zh',
      itn: true,
      parameters: { seed: 1 },
    })
    expect(captured[0]!.url).toContain('/compatible-mode/v1/chat/completions')
    expect(captured[0]!.body).toMatchObject({
      model: 'qwen3-asr-flash',
      seed: 1,
      asr_options: { language: 'zh', enable_itn: true },
    })
    expect(captured[0]!.body.messages[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: '术语' }],
    })
    expect(captured[0]!.body.messages[1].content[0].input_audio.data).toBe(
      'https://example.com/a.wav',
    )
  })

  it('speech_to_text：本地文件读成 Data URI，itn 缺省为 false', async () => {
    const { captured, error } = await call('speech_to_text', { audio: wav })
    expect(error).toBeUndefined()
    expect(captured[0]!.body.messages[0].content[0].input_audio.data).toMatch(
      /^data:audio\/wav;base64,/,
    )
    expect(captured[0]!.body.asr_options.enable_itn).toBe(false)
  })

  it('clone_voice：audio / url 别名、target_model、prefix、language、降噪与时长', async () => {
    const { captured } = await call('clone_voice', {
      audio: 'https://example.com/a.wav',
      target_model: 'bailian:cosyvoice-v3.5-flash',
      prefix: 'abc',
      language: 'zh',
      enable_preprocess: true,
      max_prompt_audio_length: 12,
    })
    expect(captured[0]!.url).toContain('/audio/tts/customization')
    const body = captured[0]!.body
    expect(body.input).toMatchObject({
      action: 'create_voice',
      target_model: 'cosyvoice-v3.5-flash',
      prefix: 'abc',
      audio: 'https://example.com/a.wav',
    })
    expect(JSON.stringify(body)).toContain('language_hints')
    expect(JSON.stringify(body)).toContain('enable_preprocess')
  })

  it('clone_voice：旧 url 并入 audio', async () => {
    const { captured } = await call('clone_voice', {
      url: 'https://example.com/a.wav',
      target_model: 'cosyvoice-v3.5-flash',
    })
    expect(captured[0]!.body.input.audio).toBe('https://example.com/a.wav')
  })

  it('design_voice：描述、试听文本与格式进 customization', async () => {
    const { captured } = await call('design_voice', {
      voice_prompt: '沉稳的中年男性',
      preview_text: '这是一段用于试听的文本，长度足够。',
      target_model: 'bailian:cosyvoice-v3.5-flash',
      prefix: 'abc',
      language: 'zh',
      sample_rate: 24000,
      response_format: 'wav',
    })
    expect(captured[0]!.url).toContain('/audio/tts/customization')
    expect(JSON.stringify(captured[0]!.body)).toContain('沉稳的中年男性')
    expect(JSON.stringify(captured[0]!.body)).toContain('"sample_rate":24000')
  })

  it('animate_portrait：image / audio 换成 image_url / audio_url，resolution 与 parameters 生效', async () => {
    const { captured } = await call('animate_portrait', {
      image: 'https://example.com/a.png',
      audio: 'https://example.com/a.wav',
      resolution: '480P',
      parameters: { style: 'speech' },
    })
    expect(captured[0]!.url).toContain('/video-synthesis')
    expect(captured[0]!.body).toMatchObject({
      input: { image_url: 'https://example.com/a.png', audio_url: 'https://example.com/a.wav' },
      parameters: { resolution: '480P', style: 'speech' },
    })
  })
})

describe('bailian 图片 / 视频 / 语音经 submit', () => {
  it('generate_image：负向提示词、扩写、水印、尺寸、张数、种子、thinking、parameters', async () => {
    const { captured } = await call('generate_image', {
      model: 'bailian:qwen-image-3.0',
      prompt: 'p',
      images: [png],
      negative_prompt: 'bad',
      prompt_extend: true,
      watermark: true,
      size: '1024*1024',
      n: 2,
      seed: 7,
      thinking: true,
      parameters: { prompt_extend_mode: 'direct' },
    })
    const body = captured[0]!.body
    expect(body.parameters).toMatchObject({
      negative_prompt: 'bad',
      prompt_extend: true,
      watermark: true,
      size: '1024*1024',
      n: 2,
      seed: 7,
      enable_thinking: true,
      prompt_extend_mode: 'direct',
    })
    expect(body.input.messages[0].content[1].image).toMatch(/^data:image\/png;base64,/)
  })

  it('generate_video：画幅、时长、种子、分辨率、扩写、音频、水印与首帧', async () => {
    const { captured, error } = await call(
      'generate_video',
      {
        model: 'bailian:wan3.0-video',
        prompt: 'p',
        resolution: '1080P',
        ratio: '9:16',
        duration: 6,
        seed: 3,
        prompt_extend: true,
        audio: false,
        watermark: true,
        parameters: { custom: 1 },
      },
      () => Response.json({ output: { task_id: 't1', task_status: 'PENDING' } }),
    )
    expect(error).toBeUndefined()
    expect(captured[0]!.body.parameters).toMatchObject({
      resolution: '1080P',
      ratio: '9:16',
      duration: 6,
      seed: 3,
      prompt_extend: true,
      audio: false,
      watermark: true,
      custom: 1,
    })
  })

  it('text_to_speech：voice / instructions 生效', async () => {
    const { captured } = await call('text_to_speech', {
      text: '你好',
      voice: 'Cherry',
      instructions: '温柔',
    })
    expect(captured[0]!.body.input).toMatchObject({
      text: '你好',
      voice: 'Cherry',
      instruction: '温柔',
    })
  })

  it('text_to_speech：out_dir 把音频下载到目录', async () => {
    const out = join(dir, 'tts-out')
    const { result, error } = await call(
      'text_to_speech',
      { text: '你好', voice: 'Cherry', out_dir: out },
      (url) =>
        url.includes('/synthesis') || url.includes('SpeechSynthesizer')
          ? Response.json({ output: { audio: { url: 'https://example.com/a.wav' } } })
          : new Response(Uint8Array.from([1, 2, 3])),
    )
    expect(error).toBeUndefined()
    expect((result!.content[0] as { text: string }).text).toContain(out)
  })
})
