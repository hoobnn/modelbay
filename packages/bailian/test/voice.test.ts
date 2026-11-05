import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  buildCloneRequest,
  buildDesignRequest,
  buildGetVoiceRequest,
  buildListVoicesRequest,
  CLONE_AUDIO_LIMIT,
  cloneAudio,
  cloneVoice,
  CUSTOMIZATION,
  designVoice,
  ENROLLMENT,
  getVoice,
  listVoices,
  parseVoiceResult,
  voiceTargets,
  VOICE_KINDS,
  checkCloneTarget,
  checkDesignTarget,
  checkPrefix,
} from '../src/voice'
import { all } from '../src/models/index'
import { fakeContext, fixture } from './helpers'

const targets = voiceTargets(all)

describe('validation helpers', () => {
  it('checkPrefix', () => {
    expect(checkPrefix('custom')).toBeNull()
    expect(checkPrefix('a'.repeat(11))).toMatch(/1–10/)
    expect(checkPrefix('bad-prefix')).toMatch(/字母或数字/)
  })
  it('clone / design targets 全部来自声明', () => {
    expect(targets.defaultTarget).toBe('qwen-audio-3.1-tts-flash')
    expect(checkCloneTarget(targets.defaultTarget, targets)).toBeNull()
    expect(checkCloneTarget('nope', targets)).toMatch(/声音复刻/)
    expect(targets.design).not.toContain('cosyvoice-v2')
    expect(targets.clone).toContain('cosyvoice-v2')
    expect(checkDesignTarget('cosyvoice-v2', targets)).toMatch(/声音设计/)
    expect(checkDesignTarget('qwen-audio-3.1-tts-flash', targets)).toBeNull()
    expect(VOICE_KINDS).toContain('cosyvoice')
    expect(targets.languages['qwen-audio-3.1-tts-flash']).toContain('zh')
  })
  it('language_hints 与预处理参数的适用范围按官方文档区分', () => {
    // cosyvoice-v2 不支持 language_hints，也不支持音频预处理参数。
    expect(targets.languages['cosyvoice-v2']).toBeUndefined()
    expect(targets.preprocess['cosyvoice-v2']).toBe(false)
    // cosyvoice-v3-plus 支持 language_hints，但不支持音频预处理参数。
    expect(targets.languages['cosyvoice-v3-plus']).toContain('zh')
    expect(targets.preprocess['cosyvoice-v3-plus']).toBe(false)
    expect(targets.preprocess['qwen-audio-3.1-tts-flash']).toBe(true)
  })
})

describe('cloneAudio', () => {
  it('accepts public http(s) URLs and valid data URIs', async () => {
    const ctx = fakeContext().ctx
    expect(await cloneAudio('https://example.com/a.wav', ctx)).toBe('https://example.com/a.wav')
    expect(await cloneAudio('data:audio/wav;base64,AAEC', ctx)).toBe('data:audio/wav;base64,AAEC')
  })
  it('rejects oss://, local paths, bad mime, oversized and empty data URIs', async () => {
    const ctx = fakeContext().ctx
    await expect(cloneAudio('oss://b/a.wav', ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(cloneAudio('/tmp/a.wav', ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(cloneAudio('data:application/zip;base64,AAEC', ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(cloneAudio('data:audio/wav;base64,', ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const big = 'A'.repeat(Math.ceil((CLONE_AUDIO_LIMIT + 2) / 3) * 4 + 4)
    await expect(cloneAudio(`data:audio/wav;base64,${big}`, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('encodes an AssetRef and validates its mime/size', async () => {
    const ok = fakeContext([], { mime: 'audio/mpeg' })
    expect(await cloneAudio({ assetId: 'a1', kind: 'audio' }, ok.ctx)).toBe(
      'data:audio/mpeg;base64,AQID',
    )
    const bad = fakeContext([], { mime: 'application/zip' })
    await expect(cloneAudio({ assetId: 'a1', kind: 'audio' }, bad.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const empty = fakeContext([], { mime: 'audio/wav', data: new Uint8Array() })
    await expect(cloneAudio({ assetId: 'a1', kind: 'audio' }, empty.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('request builders', () => {
  it('buildCloneRequest matches the recorded enrollment body', () => {
    const f = fixture('voice-clone')
    const body = buildCloneRequest(
      {
        audio: 'https://example.com/sample.wav',
        targetModel: 'qwen-audio-3.0-tts-flash',
        prefix: 'custom',
        language: 'zh',
      },
      'https://example.com/sample.wav',
      targets,
    )
    expect(body).toEqual(f.request.body)
  })
  it('buildCloneRequest validates target/prefix/language/advanced options', () => {
    const base = { audio: 'https://x', targetModel: 'qwen-audio-3.1-tts-flash' }
    expect(() => buildCloneRequest({ ...base, targetModel: 'nope' }, 'https://x', targets)).toThrow(
      ProviderError,
    )
    expect(() =>
      buildCloneRequest({ ...base, prefix: 'bad-prefix' }, 'https://x', targets),
    ).toThrow(ProviderError)
    expect(() => buildCloneRequest({ ...base, language: 'xx' }, 'https://x', targets)).toThrow(
      ProviderError,
    )
    expect(() =>
      buildCloneRequest({ ...base, maxPromptAudioLength: 40 }, 'https://x', targets),
    ).toThrow(ProviderError)
    expect(() =>
      buildCloneRequest(
        { audio: 'https://x', targetModel: 'cosyvoice-v2', language: 'zh' },
        'https://x',
        targets,
      ),
    ).toThrow(ProviderError)
    const body = buildCloneRequest(
      { ...base, enablePreprocess: true, maxPromptAudioLength: 10 },
      'https://x',
      targets,
    )
    expect((body.input as Record<string, unknown>).enable_preprocess).toBe(true)
    expect((body.input as Record<string, unknown>).max_prompt_audio_length).toBe(10)
  })
  it('buildDesignRequest matches the recorded enrollment body', () => {
    const f = fixture('voice-design')
    const body = buildDesignRequest(
      {
        voicePrompt: '三十岁左右的男声，低沉温和',
        previewText: '你好，欢迎收听今天的节目，我是主持人。',
        targetModel: 'qwen-audio-3.1-tts-flash',
        prefix: 'custom',
      },
      targets,
    )
    expect(body).toEqual(f.request.body)
  })
  it('buildDesignRequest validates prompt/preview/target/language/format', () => {
    const base = {
      voicePrompt: '描述',
      previewText: 'abcdefghijklmnop',
      targetModel: 'qwen-audio-3.1-tts-flash',
    }
    expect(() => buildDesignRequest({ ...base, previewText: 'short' }, targets)).toThrow(
      ProviderError,
    )
    expect(() => buildDesignRequest({ ...base, voicePrompt: '' }, targets)).toThrow(ProviderError)
    expect(() => buildDesignRequest({ ...base, targetModel: 'cosyvoice-v2' }, targets)).toThrow(
      ProviderError,
    )
    expect(() => buildDesignRequest({ ...base, language: 'ja' as 'zh' }, targets)).toThrow(
      ProviderError,
    )
    expect(() => buildDesignRequest({ ...base, sampleRate: 8000 as 24000 }, targets)).toThrow(
      ProviderError,
    )
    expect(() => buildDesignRequest({ ...base, responseFormat: 'flac' as 'wav' }, targets)).toThrow(
      ProviderError,
    )
  })
  it('list / query builders', () => {
    expect(buildListVoicesRequest({ prefix: 'custom' })).toEqual(fixture('voice-list').request.body)
    expect(buildGetVoiceRequest('v1')).toEqual(fixture('voice-query').request.body)
    expect(() => buildListVoicesRequest({ pageIndex: -1 })).toThrow(ProviderError)
    expect(() => buildListVoicesRequest({ pageSize: 101 })).toThrow(ProviderError)
    expect(() => buildGetVoiceRequest('')).toThrow(ProviderError)
  })
})

describe('parseVoiceResult', () => {
  it('extracts voice id, target model, status and preview', () => {
    const result = parseVoiceResult(fixture('voice-design').response.body)
    expect(result.voiceId).toBe('qwen-audio-3.1-tts-flash-custom-def')
    expect(result.previewData).toBe('AAEC')
    expect(result.requestId).toBe('req-voice-2')
  })
  it('leaves voiceId undefined when absent', () => {
    expect(parseVoiceResult({ output: {} }).voiceId).toBeUndefined()
  })
})

describe('enrollment calls (recorded fixtures)', () => {
  it('cloneVoice posts to CUSTOMIZATION and parses the result', async () => {
    const f = fixture('voice-clone')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await cloneVoice(
      ctx,
      {
        audio: 'https://example.com/sample.wav',
        targetModel: 'qwen-audio-3.0-tts-flash',
        prefix: 'custom',
        language: 'zh',
      },
      targets,
    )
    expect(CUSTOMIZATION).toBe('/api/v1/services/audio/tts/customization')
    expect(ENROLLMENT).toBe('voice-enrollment')
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.voiceId).toBe('qwen-audio-3.0-tts-flash-custom-abc')
  })
  it('cloneVoice refuses a response without a voice id', async () => {
    const { ctx } = fakeContext([{ output: {} }])
    await expect(cloneVoice(ctx, { audio: 'https://x' }, targets)).rejects.toMatchObject({
      code: 'unknown',
    })
  })
  it('designVoice posts the design body', async () => {
    const f = fixture('voice-design')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await designVoice(
      ctx,
      {
        voicePrompt: '三十岁左右的男声，低沉温和',
        previewText: '你好，欢迎收听今天的节目，我是主持人。',
        targetModel: 'qwen-audio-3.1-tts-flash',
        prefix: 'custom',
      },
      targets,
    )
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.previewData).toBe('AAEC')
  })
  it('designVoice refuses a response without a voice id', async () => {
    const { ctx } = fakeContext([{ output: {} }])
    await expect(
      designVoice(
        ctx,
        {
          voicePrompt: '描述',
          previewText: 'abcdefghijklmnop',
          targetModel: 'qwen-audio-3.1-tts-flash',
        },
        targets,
      ),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
  it('listVoices and getVoice parse their fixtures', async () => {
    const lf = fixture('voice-list')
    const l = fakeContext([lf.response.body])
    const listed = await listVoices(l.ctx, { prefix: 'custom' })
    expect(l.calls()[0]?.body).toEqual(lf.request.body)
    expect(listed.voices).toHaveLength(2)
    const qf = fixture('voice-query')
    const q = fakeContext([qf.response.body])
    const got = await getVoice(q.ctx, 'v1')
    expect(q.calls()[0]?.body).toEqual(qf.request.body)
    expect(got.voiceId).toBe('v1')
    expect(got.status).toBe('OK')
  })
})

// ── 官方接口契约用例 ──────────

describe('移植：clone_voice_uses_voice_enrollment_create_voice', () => {
  it('复刻走 voice-enrollment 的 create_voice，默认目标是声明里的默认模型', async () => {
    const { ctx, calls } = fakeContext([
      { output: { voice_id: 'qwen-audio-3.1-tts-flash-me-1' }, usage: { count: 1 } },
    ])
    const result = await cloneVoice(
      ctx,
      { audio: 'https://example.test/a.wav', prefix: 'me', language: 'zh' },
      targets,
    )
    expect(calls()[0]?.url).toContain(CUSTOMIZATION)
    expect(calls()[0]?.body).toEqual({
      model: ENROLLMENT,
      input: {
        action: 'create_voice',
        target_model: 'qwen-audio-3.1-tts-flash',
        prefix: 'me',
        audio: 'https://example.test/a.wav',
        language_hints: ['zh'],
      },
    })
    expect(result.voiceId).toBe('qwen-audio-3.1-tts-flash-me-1')
    expect(result.targetModel).toBe('qwen-audio-3.1-tts-flash')
  })
})
