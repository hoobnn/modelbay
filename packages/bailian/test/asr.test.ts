import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  ASR_MODEL,
  ASR_PATH,
  buildAsrRequest,
  checkAsrModel,
  parseAsrResponse,
  resolveAudio,
  transcribeAudio,
} from '../src/asr'
import { fakeContext, fixture } from './helpers'

describe('checkAsrModel', () => {
  it('accepts the current model', () => {
    expect(checkAsrModel(ASR_MODEL)).toBeNull()
  })
  it('rejects retired date snapshots', () => {
    expect(checkAsrModel('qwen3-asr-flash-2026-10-01')).toMatch(/retired/)
    expect(checkAsrModel('qwen3-asr-flash-2026-10-01-filetrans')).toMatch(/retired/)
  })
  it('rejects other protocols', () => {
    expect(checkAsrModel('fun-asr')).toMatch(/Only/)
  })
})

describe('buildAsrRequest', () => {
  it('builds context, input_audio and asr_options', () => {
    const { path, body } = buildAsrRequest(
      { audio: 'https://example.com/a.wav', context: '会议录音', language: 'zh', itn: true },
      'https://example.com/a.wav',
    )
    expect(path).toBe(ASR_PATH)
    expect(body).toEqual({
      model: ASR_MODEL,
      messages: [
        { role: 'system', content: [{ type: 'text', text: '会议录音' }] },
        {
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: 'https://example.com/a.wav' } }],
        },
      ],
      asr_options: { enable_itn: true, language: 'zh' },
    })
  })
  it('merges extra parameters but rejects protected keys', () => {
    const { body } = buildAsrRequest(
      { audio: 'https://x', parameters: { top_p: 0.9 } },
      'https://x',
    )
    expect(body.top_p).toBe(0.9)
    expect(() =>
      buildAsrRequest({ audio: 'https://x', parameters: { model: 'x' } }, 'https://x'),
    ).toThrow(ProviderError)
  })
  it('rejects a non-supported model', () => {
    expect(() => buildAsrRequest({ audio: 'https://x', model: 'fun-asr' }, 'https://x')).toThrow(
      ProviderError,
    )
  })
})

describe('parseAsrResponse', () => {
  it('parses text, audio_info annotation and usage', () => {
    expect(parseAsrResponse(fixture('asr-success').response.body)).toEqual({
      text: '今天讨论模型迁移。',
      language: 'zh',
      emotion: 'neutral',
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    })
  })
  it('defaults missing fields', () => {
    expect(parseAsrResponse({ choices: [{ message: {} }] })).toEqual({ text: '' })
  })
})

describe('resolveAudio', () => {
  it('passes remote URLs, oss and data URIs through', async () => {
    const ctx = fakeContext().ctx
    expect(await resolveAudio('https://example.com/a.wav', ctx)).toBe('https://example.com/a.wav')
    expect(await resolveAudio('oss://bucket/a.mp3', ctx)).toBe('oss://bucket/a.mp3')
    expect(await resolveAudio('data:audio/wav;base64,AAEC', ctx)).toBe('data:audio/wav;base64,AAEC')
  })
  it('rejects local paths and empty strings', async () => {
    const ctx = fakeContext().ctx
    await expect(resolveAudio('/tmp/a.wav', ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(resolveAudio('', ctx)).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('encodes an AssetRef as a data URI', async () => {
    const { ctx } = fakeContext([], { mime: 'audio/wav' })
    expect(await resolveAudio({ assetId: 'a1', kind: 'audio' }, ctx)).toBe(
      'data:audio/wav;base64,AQID',
    )
  })
  it('rejects unsupported mime, empty data and a missing assets source', async () => {
    const a = fakeContext([], { mime: 'application/zip' })
    await expect(resolveAudio({ assetId: 'a1', kind: 'audio' }, a.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const b = fakeContext([], { mime: 'audio/wav', data: new Uint8Array() })
    await expect(resolveAudio({ assetId: 'a1', kind: 'audio' }, b.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const c = fakeContext([])
    c.ctx.assets = undefined
    await expect(resolveAudio({ assetId: 'a1', kind: 'audio' }, c.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('transcribeAudio (recorded fixture)', () => {
  it('constructs the recorded request and parses the response', async () => {
    const f = fixture('asr-success')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await transcribeAudio(ctx, {
      audio: 'https://example.com/a.wav',
      context: '会议录音',
      language: 'zh',
      itn: true,
    })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.text).toBe('今天讨论模型迁移。')
    expect(result.language).toBe('zh')
  })
})
