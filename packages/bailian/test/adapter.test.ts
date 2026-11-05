import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type AdapterRequest, type ModelDeclaration } from '@modelbay/core'
import {
  createBailianAdapter,
  defaultModel,
  inlineImage,
  NODE_ONLY_CAPABILITIES,
  uploadAsset,
} from '../src/adapter'
import { nativeOperationSchemas } from '../src/native'
import { all as bailianModels } from '../src/models/index'
import { fakeContext, fixture } from './helpers'

function declaration(
  id: string,
  status: 'active' | 'superseded' | 'retired',
  extra: Partial<ModelDeclaration> = {},
): ModelDeclaration {
  return {
    canonicalId: `aliyun/${id}`,
    id,
    title: id,
    capabilities: ['text.chat'],
    channels: [{ channel: 'bailian', id }],
    aliases: {},
    lifecycle: { status, source: { url: 'https://help.aliyun.com/', checkedAt: '2026-11-04' } },
    source: { url: 'https://help.aliyun.com/', checkedAt: '2026-11-04' },
    ...extra,
  }
}

const models = [
  declaration('retired-model', 'retired'),
  declaration('superseded-model', 'superseded'),
  declaration('active-model', 'active', { default: true }),
]

describe('createBailianAdapter / defineAdapter', () => {
  it('exposes the adapter identity, channels and native operations', () => {
    const adapter = createBailianAdapter(models)
    expect(adapter.id).toBe('aliyun/bailian')
    expect(adapter.channels).toEqual(['bailian'])
    expect(adapter.models).toBe(models)
    expect(adapter.nativeOperations).toContain('rerank')
    expect(adapter.nativeOperations).toContain('text-embed')
    expect(adapter.nodeOnly).toEqual(['image-edit'])
    expect(adapter.docsUrl).toContain('aliyun')
    expect(Object.keys(nativeOperationSchemas(models)).length).toBe(
      adapter.nativeOperations?.length,
    )
  })
  it('rejects duplicate canonical ids (defineAdapter)', () => {
    expect(() =>
      createBailianAdapter([declaration('a', 'active'), declaration('a', 'active')]),
    ).toThrow()
  })
})

describe('default model (only active)', () => {
  it('selects the active model through core, never a superseded/retired one', () => {
    expect(defaultModel(models, 'text.chat')).toBe('active-model')
    expect(defaultModel(models, 'image.generate')).toBeNull()
  })
  it('returns null when no active model exists', () => {
    expect(defaultModel([declaration('old', 'retired')], 'text.chat')).toBeNull()
  })
})

describe('submit: request construction and response parsing (fixtures)', () => {
  it('text.chat', async () => {
    const f = fixture('chat-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const request: AdapterRequest = {
      capability: 'text.chat',
      model: 'qwen3.8-max',
      input: { messages: [{ role: 'user', content: '你好' }] },
    }
    const result = await createBailianAdapter(models).submit(request, ctx)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result).toMatchObject({ state: 'succeeded' })
    expect(result.state === 'succeeded' && result.outputs[0]).toEqual({
      type: 'text',
      text: '你好！',
    })
    expect(result.state === 'succeeded' && result.usage).toEqual({
      inputTokens: 5,
      outputTokens: 3,
    })
  })
  it('text.chat passes platform-specific extra fields and tools through', async () => {
    const { ctx, calls } = fakeContext([{ choices: [{ message: { content: 'ok' } }] }])
    await createBailianAdapter(models).submit(
      {
        capability: 'text.chat',
        model: 'qwen3.8-max',
        input: {
          messages: [{ role: 'user', content: 'hi' }],
          tools: [{ name: 'f', description: 'd', parameters: {} }],
          jsonSchema: { type: 'object' },
          temperature: 0.5,
          maxTokens: 100,
          extra: { top_p: 0.9, enable_thinking: true },
        },
      },
      ctx,
    )
    expect(calls()[0]?.body).toMatchObject({
      tools: [{ name: 'f' }],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 100,
      top_p: 0.9,
      enable_thinking: true,
    })
  })
  it('text.chat parses tool_calls', async () => {
    const { ctx } = fakeContext([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'f', arguments: { a: 1 } } }],
            },
          },
        ],
      },
    ])
    const result = await createBailianAdapter(models).submit(
      {
        capability: 'text.chat',
        model: 'qwen3.8-max',
        input: { messages: [{ role: 'user', content: 'hi' }] },
      },
      ctx,
    )
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'tool_calls',
      calls: [{ id: 'c1', name: 'f', arguments: { a: 1 } }],
    })
  })
  it('image.generate', async () => {
    const f = fixture('image-generate')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await createBailianAdapter(models).submit(
      { capability: 'image.generate', model: 'qwen-image-3.0', input: { prompt: '一只猫' } },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'image',
      url: 'https://example.com/cat.png',
    })
  })
  it('image.generate rejects an empty prompt', async () => {
    const { ctx } = fakeContext([])
    await expect(
      createBailianAdapter(models).submit(
        { capability: 'image.generate', model: 'qwen-image-3.0', input: { prompt: '' } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('audio.speech via qwen3-tts-flash', async () => {
    const f = fixture('tts-qwen')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await createBailianAdapter(models).submit(
      {
        capability: 'audio.speech',
        model: 'qwen3-tts-flash',
        input: { text: '测试文本', voice: 'Cherry', extra: { language_type: 'Auto' } },
      },
      ctx,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
      url: 'https://example.com/a.wav',
    })
  })
  it('audio.speech via SpeechSynthesizer', async () => {
    const f = fixture('tts-synthesizer')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await createBailianAdapter(bailianModels).submit(
      {
        capability: 'audio.speech',
        model: 'qwen-audio-3.1-tts-flash',
        input: {
          text: '你好，世界。',
          voice: 'qwen-audio-3.1-tts-flash-custom',
          instruction: '用温柔的语气',
          extra: { language_hints: ['zh'] },
        },
      },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state).toBe('succeeded')
  })
  it('video.generate returns a pending async task', async () => {
    const f = fixture('video-task')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await createBailianAdapter(models).submit(
      { capability: 'video.generate', model: 'wan3.0-video', input: { prompt: '海浪' } },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(calls()[0]?.headers).toMatchObject({ 'X-DashScope-Async': 'enable' })
    expect(result).toEqual({ state: 'pending', remoteId: 'task-123', pollAfterMs: 10_000 })
  })
  it('video.generate rejects an empty request and a missing task_id', async () => {
    const a = fakeContext([])
    await expect(
      createBailianAdapter(models).submit(
        { capability: 'video.generate', model: 'wan3.0-video', input: { prompt: '' } },
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const b = fakeContext([{ output: {} }])
    await expect(
      createBailianAdapter(models).submit(
        { capability: 'video.generate', model: 'wan3.0-video', input: { prompt: '海浪' } },
        b.ctx,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
  it('node-only capabilities point at the subpath', async () => {
    const { ctx } = fakeContext([])
    // 用真实声明，能力范围（放大倍数、扩图比例）要按声明校验。
    const adapter = createBailianAdapter(bailianModels)
    expect(NODE_ONLY_CAPABILITIES).toEqual(['image.edit', 'image.process'])
    const edit = await adapter
      .submit(
        {
          capability: 'image.edit',
          model: 'wanx2.1-imageedit',
          input: {
            prompt: 'x',
            image: { assetId: 'a', kind: 'image' },
            mask: { assetId: 'b', kind: 'image' },
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(edit).toMatchObject({ code: 'invalid_input' })
    expect((edit as Error).message).toContain('@modelbay/bailian/image-edit')
    const process = await adapter
      .submit(
        {
          capability: 'image.process',
          model: 'wanx2.1-imageedit',
          input: { image: { assetId: 'a', kind: 'image' }, operation: 'upscale', scale: 2 },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(process).toMatchObject({ code: 'invalid_input' })
    expect((process as Error).message).toContain('@modelbay/bailian/image-edit')
  })
  it('rejects an unsupported capability', async () => {
    const { ctx } = fakeContext([])
    await expect(
      createBailianAdapter(models).submit(
        { capability: 'audio.music', model: 'x', input: { prompt: 'x' } },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('poll / cancel (async task polling)', () => {
  const adapter = createBailianAdapter(models)
  it('PENDING / RUNNING -> pending with queued/running', async () => {
    const a = fakeContext([{ output: { task_status: 'PENDING' } }])
    expect(await adapter.poll!('task-1', a.ctx)).toMatchObject({
      state: 'pending',
      remote: 'queued',
      pollAfterMs: 10_000,
    })
    const b = fakeContext([{ output: { task_status: 'RUNNING' } }])
    expect(await adapter.poll!('task-1', b.ctx)).toMatchObject({
      state: 'pending',
      remote: 'running',
    })
  })
  it('SUCCEEDED with video_url', async () => {
    const f = fixture('task-succeeded')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.poll!('task-123', ctx)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(result).toMatchObject({ state: 'succeeded' })
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      kind: 'video',
      url: 'https://example.com/v.mp4',
    })
  })
  it('SUCCEEDED with results[] (image edit)', async () => {
    const { ctx } = fakeContext([
      { output: { task_status: 'SUCCEEDED', results: [{ url: 'http://e/1.png' }] } },
    ])
    const result = await adapter.poll!('task-1', ctx)
    expect(result.state === 'succeeded' && result.outputs).toHaveLength(1)
  })
  it('FAILED -> failed with the upstream message', async () => {
    const f = fixture('task-failed')
    const { ctx } = fakeContext([f.response.body])
    expect(await adapter.poll!('task-123', ctx)).toMatchObject({ state: 'failed' })
  })
  it('CANCELED -> failed cancelled', async () => {
    const { ctx } = fakeContext([{ output: { task_status: 'CANCELED' } }])
    expect(await adapter.poll!('task-1', ctx)).toEqual({
      state: 'failed',
      error: { code: 'cancelled', message: 'Bailian task was cancelled' },
    })
  })
  it('unknown status throws so the host keeps the task id', async () => {
    const { ctx } = fakeContext([{ output: { task_status: 'WEIRD' } }])
    await expect(adapter.poll!('task-1', ctx)).rejects.toMatchObject({ code: 'unknown' })
  })
  it('cancel accepts a CANCELED response and rejects a non-cancel status', async () => {
    const a = fakeContext([{ output: { task_status: 'CANCELED' } }])
    await expect(adapter.cancel!('task-1', a.ctx)).resolves.toBeUndefined()
    const b = fakeContext([{ output: { code: 'NotAllowed' } }])
    await expect(adapter.cancel!('task-1', b.ctx)).rejects.toBeInstanceOf(ProviderError)
  })
  it('native() delegates to runBailianNative', async () => {
    const f = fixture('rerank')
    const { ctx } = fakeContext([f.response.body])
    const result = await adapter.native!(
      'rerank',
      { query: 'apple', documents: ['苹果', '香蕉'], top_n: 2 },
      ctx,
    )
    expect((result as { results: unknown[] }).results).toHaveLength(1)
  })
})

describe('asset helpers', () => {
  it('inlineImage builds a base64 data URL', async () => {
    const { ctx } = fakeContext([], { mime: 'image/png' })
    expect(await inlineImage(ctx, { assetId: 'a1', kind: 'image' })).toBe(
      'data:image/png;base64,AQID',
    )
    const bad = fakeContext([], { mime: 'application/zip' })
    await expect(inlineImage(bad.ctx, { assetId: 'a1', kind: 'image' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('uploadAsset posts the policy then the multipart form', async () => {
    const policy = fixture('upload-policy')
    const { ctx, calls } = fakeContext([policy.response.body, new Response('', { status: 200 })])
    const url = await uploadAsset(ctx, { assetId: 'a1', kind: 'image' }, 'wan3.0-video')
    expect(calls()[0]?.url).toBe(policy.request.url)
    expect(calls()[1]?.url).toBe('https://oss.example.com')
    expect(url).toMatch(/^oss:\/\/tmp\/123\//)
  })
  it('uploadAsset validates the asset source, mime and size', async () => {
    const noAssets = fakeContext([])
    noAssets.ctx.assets = undefined
    await expect(
      uploadAsset(noAssets.ctx, { assetId: 'a1', kind: 'image' }, 'm'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const badMime = fakeContext([], { mime: 'application/zip' })
    await expect(
      uploadAsset(badMime.ctx, { assetId: 'a1', kind: 'image' }, 'm'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const incomplete = fakeContext([{ data: { upload_host: 'https://x' } }])
    await expect(
      uploadAsset(incomplete.ctx, { assetId: 'a1', kind: 'image' }, 'm'),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})
