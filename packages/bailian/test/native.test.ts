import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  BAILIAN_NATIVE_OPERATIONS,
  digitalHumanLipsync,
  EMBED_MULTIMODAL_PATH,
  nativeOperationSchemas,
  rerank,
  runBailianNative,
  textEmbed,
} from '../src/native'
import { fakeContext, fixture } from './helpers'
import { all } from '../src/models/index'

const models = all

describe('native operation declarations', () => {
  it('declares a schema for every exposed operation', () => {
    const schemas = nativeOperationSchemas(models)
    expect(Object.keys(schemas).sort()).toEqual([...BAILIAN_NATIVE_OPERATIONS].sort())
    expect(schemas.rerank?.required).toContain('query')
    expect(schemas['text-embed']?.type).toBe('object')
  })
})

describe('rerank (recorded fixture)', () => {
  it('builds the native rerank body and normalizes results', async () => {
    const f = fixture('rerank')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await rerank(
      {
        model: 'qwen3-rerank',
        query: 'apple',
        documents: ['苹果', '香蕉'],
        top_n: 2,
        return_documents: false,
      },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.results).toHaveLength(1)
  })
  it('validates query, documents and top_n', async () => {
    const { ctx } = fakeContext([])
    await expect(rerank({ query: '', documents: ['a'] }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(rerank({ query: 'q', documents: [] }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(rerank({ query: 'q', documents: ['a'], top_n: 5 }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('textEmbed (recorded fixture)', () => {
  it('builds the compatible embeddings body', async () => {
    const f = fixture('text-embed')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await textEmbed({ texts: ['你好'], dimensions: 1024 }, ctx)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.model).toBe('text-embedding-v4')
  })
  it('routes multimodal contents to the multimodal endpoint', async () => {
    const { ctx, calls } = fakeContext([{ data: [], usage: {} }])
    await textEmbed({ contents: [{ text: 'a' }], dimensions: 512 }, ctx)
    expect(calls()[0]?.url).toContain(EMBED_MULTIMODAL_PATH)
    expect((calls()[0]!.body as Record<string, unknown>).parameters).toEqual({ dimension: 512 })
  })
  it('requires exactly one of texts/contents and rejects protected parameters', async () => {
    const { ctx } = fakeContext([])
    await expect(textEmbed({}, ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(textEmbed({ texts: ['a'], contents: [{ text: 'a' }] }, ctx)).rejects.toMatchObject(
      { code: 'invalid_input' },
    )
    await expect(
      textEmbed({ texts: ['a'], parameters: { model: 'x' } }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('digitalHumanLipsync (recorded fixture)', () => {
  it('submits an async portrait task', async () => {
    const f = fixture('portrait')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await digitalHumanLipsync(
      { image_url: 'https://example.com/face.png', audio_url: 'https://example.com/voice.wav' },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(calls()[0]?.headers).toMatchObject({
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    })
    expect(result.taskId).toBe('portrait-1')
  })
  it('rejects missing urls, bad resolution and data URIs', async () => {
    const { ctx } = fakeContext([])
    await expect(digitalHumanLipsync({ image_url: 'https://x' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      digitalHumanLipsync(
        { image_url: 'https://x', audio_url: 'https://y', resolution: '4K' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      digitalHumanLipsync({ image_url: 'data:image/png;base64,AA', audio_url: 'https://y' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('runBailianNative dispatch (the four ported Python capabilities)', () => {
  it('qwen-audio-tts -> SpeechSynthesizer', async () => {
    const f = fixture('tts-synthesizer')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await runBailianNative(
      'qwen-audio-tts',
      {
        model: 'qwen-audio-3.1-tts-flash',
        text: '你好，世界。',
        voice: 'qwen-audio-3.1-tts-flash-custom',
        instructions: '用温柔的语气',
        language: 'zh',
      },
      ctx,
      models,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect((result as { url: string }).url).toBe('https://example.com/tts.wav')
  })
  it('asr -> compatible chat/completions', async () => {
    const f = fixture('asr-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await runBailianNative(
      'asr',
      { audio: 'https://example.com/a.wav', context: '会议录音', language: 'zh', itn: true },
      ctx,
      models,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect((result as { text: string }).text).toBe('今天讨论模型迁移。')
  })
  it('voice-clone -> enrollment create_voice', async () => {
    const f = fixture('voice-clone')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await runBailianNative(
      'voice-clone',
      {
        audio: 'https://example.com/sample.wav',
        target_model: 'qwen-audio-3.0-tts-flash',
        prefix: 'custom',
        language: 'zh',
      },
      ctx,
      models,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect((result as { voiceId: string }).voiceId).toContain('custom')
  })
  it('voice-design -> enrollment create_voice with preview', async () => {
    const f = fixture('voice-design')
    const { ctx, calls } = fakeContext([f.response.body])
    await runBailianNative(
      'voice-design',
      {
        voice_prompt: '三十岁左右的男声，低沉温和',
        preview_text: '你好，欢迎收听今天的节目，我是主持人。',
        target_model: 'qwen-audio-3.1-tts-flash',
        prefix: 'custom',
      },
      ctx,
      models,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
  })
  it('voice-list and voice-query', async () => {
    const lf = fixture('voice-list')
    const l = fakeContext([lf.response.body])
    const listed = await runBailianNative('voice-list', { prefix: 'custom' }, l.ctx, models)
    expect((listed as { voices: unknown[] }).voices).toHaveLength(2)
    const qf = fixture('voice-query')
    const q = fakeContext([qf.response.body])
    const got = await runBailianNative('voice-query', { voice_id: 'v1' }, q.ctx, models)
    expect((got as { voiceId: string }).voiceId).toBe('v1')
  })
  it('rerank, text-embed and digital-human-lipsync dispatch', async () => {
    const r = fakeContext([fixture('rerank').response.body])
    await expect(
      runBailianNative(
        'rerank',
        { query: 'apple', documents: ['苹果', '香蕉'], top_n: 2 },
        r.ctx,
        models,
      ),
    ).resolves.toBeDefined()
    const e = fakeContext([fixture('text-embed').response.body])
    await expect(
      runBailianNative('text-embed', { texts: ['你好'], dimensions: 1024 }, e.ctx, models),
    ).resolves.toBeDefined()
    const p = fakeContext([fixture('portrait').response.body])
    await expect(
      runBailianNative(
        'digital-human-lipsync',
        { image_url: 'https://x/f.png', audio_url: 'https://x/a.wav' },
        p.ctx,
        models,
      ),
    ).resolves.toMatchObject({ taskId: 'portrait-1' })
  })
  it('raw-request forwards an arbitrary path and method', async () => {
    const { ctx, calls } = fakeContext([{ data: [] }])
    await runBailianNative(
      'raw-request',
      { path: '/compatible-mode/v1/models', method: 'GET' },
      ctx,
      models,
    )
    expect(calls()[0]?.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models')
    expect(calls()[0]?.method).toBe('GET')
    await expect(
      runBailianNative('raw-request', { path: 'models' }, ctx, models),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('rejects an unknown operation', async () => {
    const { ctx } = fakeContext([])
    await expect(runBailianNative('nope', {}, ctx, models)).rejects.toBeInstanceOf(ProviderError)
  })
})
