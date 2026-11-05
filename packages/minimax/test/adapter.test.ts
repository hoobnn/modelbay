import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type AdapterRequest, type ModelDeclaration } from '@modelbay/core'
import { createMinimaxAdapter, defaultModel, fromHex } from '../src/adapter'
import { all } from '../src/models/index'
import { nativeOperationSchemas } from '../src/native'
import { fakeContext, fixture } from './helpers'

function declaration(
  id: string,
  status: 'active' | 'superseded' | 'retired',
  extra: Partial<ModelDeclaration> = {},
): ModelDeclaration {
  return {
    canonicalId: `minimax/${id}`,
    id,
    title: id,
    capabilities: ['text.chat'],
    channels: [{ channel: 'minimax', id }],
    aliases: {},
    lifecycle: { status, source: { url: 'https://platform.minimax.cn/', checkedAt: '2026-11-04' } },
    source: { url: 'https://platform.minimax.cn/', checkedAt: '2026-11-04' },
    ...extra,
  }
}
const models = [
  declaration('retired-model', 'retired'),
  declaration('superseded-model', 'superseded'),
  declaration('active-model', 'active', { default: true }),
]

describe('createMinimaxAdapter / defineAdapter', () => {
  it('exposes identity, channels, native operations and schemas', () => {
    const adapter = createMinimaxAdapter(models)
    expect(adapter.id).toBe('minimax/api')
    expect(adapter.channels).toEqual(['minimax'])
    expect(adapter.models).toBe(models)
    expect(adapter.nativeOperations).toContain('context-ir')
    expect(adapter.nativeOperations).toContain('video-2k-rerender')
    expect(Object.keys(nativeOperationSchemas).length).toBe(adapter.nativeOperations?.length)
  })
  it('rejects duplicate canonical ids', () => {
    expect(() =>
      createMinimaxAdapter([declaration('a', 'active'), declaration('a', 'active')]),
    ).toThrow()
  })
})

describe('default model (only active)', () => {
  it('selects only the active model', () => {
    expect(defaultModel(models, 'text.chat')).toBe('active-model')
    expect(defaultModel(models, 'image.generate')).toBeNull()
    expect(defaultModel([declaration('old', 'retired')], 'text.chat')).toBeNull()
  })
})

describe('fromHex', () => {
  it('decodes hex audio without Buffer', () => {
    expect([...fromHex('0102ff')]).toEqual([1, 2, 255])
    expect(() => fromHex('')).toThrow(ProviderError)
    expect(() => fromHex('xyz')).toThrow(ProviderError)
  })
})

describe('submit (recorded fixtures)', () => {
  const adapter = createMinimaxAdapter(all)
  it('text.chat', async () => {
    const f = fixture('chat-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3',
        input: { messages: [{ role: 'user', content: '你好' }] },
      },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toEqual({
      type: 'text',
      text: '你好！',
    })
    expect(result.state === 'succeeded' && result.usage).toEqual({
      inputTokens: 5,
      outputTokens: 3,
    })
  })
  it('text.chat passes platform extra fields and structured output', async () => {
    const { ctx, calls } = fakeContext([
      { base_resp: { status_code: 0 }, choices: [{ message: { content: '{"a":1}' } }] },
    ])
    const result = await adapter.submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3',
        input: {
          messages: [{ role: 'user', content: 'hi' }],
          jsonSchema: { type: 'object' },
          temperature: 0.3,
          maxTokens: 50,
          extra: { top_p: 0.8 },
        },
      },
      ctx,
    )
    expect(calls()[0]?.body).toMatchObject({
      temperature: 0.3,
      max_completion_tokens: 50,
      top_p: 0.8,
    })
    expect((calls()[0]!.body as { messages: unknown[] }).messages).toHaveLength(2)
    expect(result.state === 'succeeded' && result.outputs[0]).toEqual({
      type: 'json',
      value: { a: 1 },
    })
  })
  it('text.chat rejects content filter and empty content', async () => {
    const a = fakeContext([{ base_resp: { status_code: 0 }, input_sensitive: true }])
    await expect(
      adapter.submit(
        {
          capability: 'text.chat',
          model: 'MiniMax-M3',
          input: { messages: [{ role: 'user', content: 'hi' }] },
        },
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'content_policy' })
    const b = fakeContext([
      {
        base_resp: { status_code: 0 },
        choices: [{ finish_reason: 'content_filter', message: {} }],
      },
    ])
    await expect(
      adapter.submit(
        {
          capability: 'text.chat',
          model: 'MiniMax-M3',
          input: { messages: [{ role: 'user', content: 'hi' }] },
        },
        b.ctx,
      ),
    ).rejects.toMatchObject({ code: 'content_policy' })
    const c = fakeContext([{ base_resp: { status_code: 0 }, choices: [{ message: {} }] }])
    await expect(
      adapter.submit(
        {
          capability: 'text.chat',
          model: 'MiniMax-M3',
          input: { messages: [{ role: 'user', content: 'hi' }] },
        },
        c.ctx,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
  it('image.generate', async () => {
    const f = fixture('image-generate')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.submit(
      { capability: 'image.generate', model: 'image-01', input: { prompt: '一只猫' } },
      ctx,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'image',
      url: 'https://example.com/cat.jpeg',
    })
  })
  it('image.generate validates prompt/count and a missing image', async () => {
    const a = fakeContext([])
    await expect(
      adapter.submit(
        { capability: 'image.generate', model: 'image-01', input: { prompt: '' } },
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const b = fakeContext([{ base_resp: { status_code: 0 }, data: {} }])
    await expect(
      adapter.submit(
        { capability: 'image.generate', model: 'image-01', input: { prompt: 'x' } },
        b.ctx,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
  it('video.generate returns a pending async task', async () => {
    const f = fixture('video-submit')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.submit(
      { capability: 'video.generate', model: 'MiniMax-H3', input: { prompt: '海浪' } },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result).toEqual({ state: 'pending', remoteId: 'task-1', pollAfterMs: 10_000 })
  })
  it('video.generate validates the duration', async () => {
    const { ctx } = fakeContext([])
    const request: AdapterRequest = {
      capability: 'video.generate',
      model: 'MiniMax-H3',
      input: { prompt: '海浪', duration: 30 },
    }
    await expect(adapter.submit(request, ctx)).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('audio.speech decodes hex audio', async () => {
    const f = fixture('speech-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.submit(
      { capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: '你好' } },
      ctx,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
    })
    expect([
      ...(result.state === 'succeeded' ? (result.outputs[0] as { data: Uint8Array }).data : []),
    ]).toEqual([1, 2])
    expect(result.state === 'succeeded' && result.usage).toEqual({ characters: 2, seconds: 1.5 })
  })
  it('audio.speech validates speed and a missing audio', async () => {
    const a = fakeContext([])
    await expect(
      adapter.submit(
        { capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: 'hi', speed: 3 } },
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const b = fakeContext([{ base_resp: { status_code: 0 }, data: {} }])
    await expect(
      adapter.submit(
        { capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: 'hi' } },
        b.ctx,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
  it('audio.music decodes hex audio', async () => {
    const f = fixture('music-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.submit(
      { capability: 'audio.music', model: 'music-3.0', input: { prompt: '轻快的钢琴' } },
      ctx,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
    })
  })
  it('rejects unsupported capabilities', async () => {
    const { ctx } = fakeContext([])
    await expect(
      adapter.submit({ capability: 'audio.sfx', model: 'x', input: { prompt: 'x' } }, ctx),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('poll / cancel (async task polling)', () => {
  const adapter = createMinimaxAdapter(all)
  it('PENDING / RUNNING -> pending', async () => {
    for (const status of ['queued', 'running']) {
      const { ctx } = fakeContext([
        { base_resp: { status_code: 0 }, task: { id: 'task-1', status } },
      ])
      expect(await adapter.poll!('task-1', ctx)).toMatchObject({ state: 'pending', remote: status })
    }
  })
  it('SUCCEEDED -> video file', async () => {
    const f = fixture('task-succeeded')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await adapter.poll!('task-1', ctx)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      kind: 'video',
      url: 'https://example.com/v.mp4',
    })
  })
  it('FAILED / CANCELLED -> failed', async () => {
    const f = fixture('task-failed')
    const a = fakeContext([f.response.body])
    expect(await adapter.poll!('task-1', a.ctx)).toMatchObject({ state: 'failed' })
    const b = fakeContext([
      { base_resp: { status_code: 0 }, task: { id: 'task-1', status: 'cancelled' } },
    ])
    expect(await adapter.poll!('task-1', b.ctx)).toMatchObject({
      state: 'failed',
      error: { code: 'cancelled' },
    })
  })
  it('rejects a mismatched task and a missing video URL', async () => {
    const a = fakeContext([
      { base_resp: { status_code: 0 }, task: { id: 'other', status: 'succeeded' } },
    ])
    await expect(adapter.poll!('task-1', a.ctx)).rejects.toMatchObject({ code: 'unknown' })
    const b = fakeContext([
      { base_resp: { status_code: 0 }, task: { id: 'task-1', status: 'succeeded', content: {} } },
    ])
    await expect(adapter.poll!('task-1', b.ctx)).rejects.toMatchObject({ code: 'unknown' })
  })
  it('cancel only DELETEs queued tasks', async () => {
    const a = fakeContext([
      { base_resp: { status_code: 0 }, task: { id: 'task-1', status: 'queued' } },
      { base_resp: { status_code: 0 } },
    ])
    await expect(adapter.cancel!('task-1', a.ctx)).resolves.toBeUndefined()
    expect(a.calls()).toHaveLength(2)
    expect(a.calls()[1]?.method).toBe('DELETE')
    const b = fakeContext([
      { base_resp: { status_code: 0 }, task: { id: 'task-1', status: 'succeeded' } },
    ])
    await expect(adapter.cancel!('task-1', b.ctx)).resolves.toBeUndefined()
    expect(b.calls()).toHaveLength(1)
  })
  it('native() delegates to runMinimaxNative', async () => {
    const { ctx } = fakeContext([fixture('context-ir').response.body])
    const result = await adapter.native!('context-ir', { prompt: '一只猫在海边' }, ctx)
    expect(result).toMatchObject({ taskId: 'ctx-1' })
  })
})
