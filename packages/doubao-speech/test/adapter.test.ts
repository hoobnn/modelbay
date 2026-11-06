import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type ModelDeclaration } from '@modelbay/core'
import {
  buildAudioCreateBody,
  buildFlashAsrBody,
  createDoubaoAdapter,
  defaultModel,
  parseFlashAsr,
} from '../src/adapter'
import { all } from '../src/models/index'
import { resolveSpeechSettings } from '../src/speech'
import { nativeOperationSchemas } from '../src/native'
import { fakeContext, fixture, fixtureReply } from './helpers'

function declaration(
  id: string,
  status: 'active' | 'superseded' | 'retired',
  extra: Partial<ModelDeclaration> = {},
): ModelDeclaration {
  return {
    canonicalId: `doubao/${id}`,
    id,
    title: id,
    capabilities: ['audio.speech'],
    channels: [{ channel: 'doubao-speech', id }],
    aliases: {},
    lifecycle: { status, source: { url: 'https://docs.volcengine.com/', checkedAt: '2026-11-04' } },
    source: { url: 'https://docs.volcengine.com/', checkedAt: '2026-11-04' },
    ...extra,
  }
}
const models = [
  declaration('retired-model', 'retired'),
  declaration('superseded-model', 'superseded'),
  declaration('active-model', 'active', { default: true }),
]

describe('createDoubaoAdapter / defineAdapter', () => {
  it('exposes identity, channels, native operations and the node-only subpath', () => {
    const adapter = createDoubaoAdapter(models)
    expect(adapter.id).toBe('doubao/speech')
    expect(adapter.channels).toEqual(['doubao-speech'])
    expect(adapter.models).toBe(models)
    expect(adapter.nativeOperations).toContain('podcast')
    expect(adapter.nativeOperations).toContain('simultaneous-interpretation')
    expect(adapter.nodeOnly).toEqual(['asr'])
    expect(Object.keys(nativeOperationSchemas).length).toBe(adapter.nativeOperations?.length)
  })
  it('rejects duplicate canonical ids', () => {
    expect(() =>
      createDoubaoAdapter([declaration('a', 'active'), declaration('a', 'active')]),
    ).toThrow()
  })
})

describe('default model (only active)', () => {
  it('selects only the active model', () => {
    expect(defaultModel(models, 'audio.speech')).toBe('active-model')
    expect(defaultModel(models, 'video.generate')).toBeNull()
    expect(defaultModel([declaration('old', 'retired')], 'audio.speech')).toBeNull()
  })
})

describe('submit (recorded fixtures)', () => {
  const adapter = createDoubaoAdapter(all)
  it('audio.speech', async () => {
    const f = fixture('tts-success')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const result = await adapter.submit(
      { capability: 'audio.speech', model: 'seed-tts-2.0', input: { text: '你好' } },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state).toBe('succeeded')
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
    })
  })
  it('audio.music', async () => {
    const f = fixture('music-create')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const result = await adapter.submit(
      { capability: 'audio.music', model: 'seed-audio-1.0', input: { prompt: '轻快的钢琴' } },
      ctx,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect([
      ...(result.state === 'succeeded' ? (result.outputs[0] as { data: Uint8Array }).data : []),
    ]).toEqual([1, 2, 3])
  })
  it('audio.sfx', async () => {
    const { ctx, calls } = fakeContext([new Response('{"code":0,"audio":"AQID"}')])
    const result = await adapter.submit(
      { capability: 'audio.sfx', model: 'seed-audio-1.0', input: { prompt: '关门声' } },
      ctx,
    )
    expect((calls()[0]!.body as { text_prompt: string }).text_prompt).toContain('仅生成音效')
    expect(result.state).toBe('succeeded')
  })
  it('audio.transcribe', async () => {
    const f = fixture('asr-flash')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const result = await adapter.submit(
      {
        capability: 'audio.transcribe',
        model: 'bigmodel',
        input: { audio: { assetId: 'a1', kind: 'audio' } },
      },
      ctx,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(calls()[0]?.headers).toMatchObject({ 'X-Api-Sequence': '-1' })
    expect(result.state === 'succeeded' && result.outputs[0]).toEqual({
      type: 'text',
      text: '今天讨论模型迁移。',
    })
    expect(result.state === 'succeeded' && result.outputs[1]).toEqual({
      type: 'json',
      value: { segments: [{ start: 0, end: 1, text: '今天' }] },
    })
  })
  it('audio.transcribe rejects a missing assets source and unsupported mime', async () => {
    const a = fakeContext([])
    a.ctx.assets = undefined
    await expect(
      adapter.submit(
        {
          capability: 'audio.transcribe',
          model: 'bigmodel',
          input: { audio: { assetId: 'a1', kind: 'audio' } },
        },
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const b = fakeContext([], { mime: 'application/zip' })
    await expect(
      adapter.submit(
        {
          capability: 'audio.transcribe',
          model: 'bigmodel',
          input: { audio: { assetId: 'a1', kind: 'audio' } },
        },
        b.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('rejects unsupported capabilities', async () => {
    const { ctx } = fakeContext([])
    await expect(
      adapter.submit({ capability: 'image.generate', model: 'x', input: { prompt: 'x' } }, ctx),
    ).rejects.toBeInstanceOf(ProviderError)
  })
  it('native() delegates to runDoubaoNative', async () => {
    const { ctx } = fakeContext([fixtureReply(fixture('translation'))])
    const result = await adapter.native!(
      'translation',
      { text_list: ['你好'], target_language: 'en' },
      ctx,
    )
    expect(result).toMatchObject({ code: 0 })
  })
})

describe('request builders / ASR parsing', () => {
  const ctx = fakeContext().ctx
  const settings = resolveSpeechSettings(ctx)
  it('buildAudioCreateBody validates duration and prompt length', () => {
    expect(() =>
      buildAudioCreateBody({ prompt: 'x', duration: 200 }, settings, 'audio.music'),
    ).toThrow(ProviderError)
    expect(() => buildAudioCreateBody({ prompt: '' }, settings, 'audio.music')).toThrow(
      ProviderError,
    )
    const body = buildAudioCreateBody({ prompt: 'x', duration: 12.5 }, settings, 'audio.music')
    expect(body.text_prompt as string).toContain('目标时长 12.5 秒')
    // Seed Audio 官方采样率只有 8K/16K/24K/48K，22050 等 TTS 才有的值要拒绝
    expect(
      buildAudioCreateBody({ prompt: 'x' }, { ...settings, sampleRate: '8000' }, 'audio.music')
        .audio_config,
    ).toEqual({ format: 'mp3', sample_rate: 8000 })
    expect(() =>
      buildAudioCreateBody({ prompt: 'x' }, { ...settings, sampleRate: '22050' }, 'audio.music'),
    ).toThrow(ProviderError)
  })
  it('buildFlashAsrBody validates the format (size comes from the declaration)', () => {
    expect(() =>
      buildFlashAsrBody(
        { audio: { assetId: 'a', kind: 'audio' } },
        { data: new Uint8Array([1]), mime: 'application/zip' },
      ),
    ).toThrow(ProviderError)
    const body = buildFlashAsrBody(
      { audio: { assetId: 'a', kind: 'audio' }, language: 'zh' },
      { data: new Uint8Array([1, 2, 3]), mime: 'audio/wav' },
    )
    expect((body.audio as Record<string, unknown>).data).toBe('AQID')
  })
  it('parseFlashAsr handles empty responses, packet errors and segments', () => {
    expect(parseFlashAsr('', ctx)).toEqual([{ type: 'text', text: '' }])
    expect(() => parseFlashAsr('{"code":45000001,"message":"bad"}', ctx)).toThrow(ProviderError)
    expect(() => parseFlashAsr('{"code":0,"result":{}}', ctx)).toThrow(ProviderError)
    expect(parseFlashAsr('{"code":0,"result":{"text":"hi","utterances":[]}}', ctx)).toEqual([
      { type: 'text', text: 'hi' },
    ])
  })
})
