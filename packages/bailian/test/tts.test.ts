import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  audioFile,
  checkTts,
  choiceContents,
  COSYVOICE_TTS,
  instructionLength,
  INSTRUCTION_MODELS,
  parseTtsResponse,
  parseUsage,
  QWEN_TTS_PATH,
  resolveTtsModel,
  splitText,
  SYNTH_MODELS,
  SYNTH_PATH,
  synthesizeQwenAudioTts,
  TTS_CHUNK,
  TTS_MODELS,
  ttsRequest,
} from '../src/tts'
import { fakeContext, fixture } from './helpers'

describe('splitText / instructionLength', () => {
  it('packs sentences into chunks up to the limit (matches Python split_text)', () => {
    expect(splitText('你好。世界！')).toEqual(['你好。世界！'])
    expect(splitText('你好。世界！', 3)).toEqual(['你好。', '世界！'])
  })
  it('hard-splits a sentence longer than the limit', () => {
    const text = '啊'.repeat(600)
    const parts = splitText(text)
    expect(parts.length).toBe(3)
    expect(parts.every((part) => part.length <= TTS_CHUNK)).toBe(true)
  })
  it('drops whitespace-only chunks', () => {
    expect(splitText('   \n ')).toEqual([])
  })
  it('counts CJK as 2 and latin as 1', () => {
    expect(instructionLength('中文ab')).toBe(6)
    expect(instructionLength('')).toBe(0)
  })
})

describe('resolveTtsModel', () => {
  it('resolves aliases', () => {
    expect(resolveTtsModel('audio-plus')).toBe(TTS_MODELS['audio-plus'])
    expect(resolveTtsModel('flash')).toBe('qwen3-tts-flash')
  })
  it('passes an explicit full model id through', () => {
    expect(resolveTtsModel('qwen-audio-3.1-tts-flash')).toBe('qwen-audio-3.1-tts-flash')
  })
  it('infers the model from a custom voice prefix', () => {
    expect(resolveTtsModel(undefined, 'cosyvoice-v3.5-plus-myvoice')).toBe('cosyvoice-v3.5-plus')
  })
  it('defaults to flash', () => {
    expect(resolveTtsModel()).toBe('qwen3-tts-flash')
  })
})

describe('ttsRequest', () => {
  it('routes SYNTH models to SpeechSynthesizer with wav/24000', () => {
    const { path, body } = ttsRequest('qwen-audio-3.1-tts-flash', { text: 'hi', voice: 'v' }, 'hi')
    expect(path).toBe(SYNTH_PATH)
    expect(body).toEqual({
      model: 'qwen-audio-3.1-tts-flash',
      input: { text: 'hi', voice: 'v', format: 'wav', sample_rate: 24000 },
    })
  })
  it('adds instruction / language_hints and merges parameters', () => {
    const { body } = ttsRequest(
      'qwen-audio-3.1-tts-flash',
      { text: 'hi', voice: 'v', instructions: 'soft', language: 'zh', parameters: { speed: 1.1 } },
      'hi',
    )
    expect((body.input as Record<string, unknown>).instruction).toBe('soft')
    expect((body.input as Record<string, unknown>).language_hints).toEqual(['zh'])
    expect((body.input as Record<string, unknown>).speed).toBe(1.1)
  })
  it('routes qwen3-tts through multimodal-generation with parameters', () => {
    const { path, body } = ttsRequest(
      'qwen3-tts-flash',
      { text: 'hi', voice: 'Cherry', language: 'Auto', parameters: { n: 1 } },
      'hi',
    )
    expect(path).toBe(QWEN_TTS_PATH)
    expect(body).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: 'hi', voice: 'Cherry', language_type: 'Auto' },
      parameters: { n: 1 },
    })
  })
  it('exposes the model families', () => {
    expect(SYNTH_MODELS).toContain('cosyvoice-v2')
    expect(COSYVOICE_TTS).toContain('cosyvoice-v2')
    expect(INSTRUCTION_MODELS).not.toContain('cosyvoice-v2')
  })
})

describe('checkTts', () => {
  it('requires a voice for synthesizer models', () => {
    expect(checkTts('qwen-audio-3.1-tts-flash', { text: 'hi' })).toMatch(/require a/)
  })
  it('rejects instruction on models without support', () => {
    expect(checkTts('cosyvoice-v2', { text: 'hi', voice: 'v', instructions: 'soft' })).toMatch(
      /does not support/,
    )
  })
  it('rejects a too-long CosyVoice instruction', () => {
    expect(
      checkTts('cosyvoice-v3.5-plus', { text: 'hi', voice: 'v', instructions: '啊'.repeat(60) }),
    ).toMatch(/100/)
  })
  it('rejects bad language codes and language=other on the wrong model', () => {
    expect(
      checkTts('cosyvoice-v3.5-plus', { text: 'hi', voice: 'v', language: 'Chinese' }),
    ).toMatch(/language must be/)
    expect(
      checkTts('qwen-audio-3.0-tts-flash', { text: 'hi', voice: 'v', language: 'other' }),
    ).toMatch(/only applies/)
  })
  it('rejects parameters overriding protected keys and non-wav local format', () => {
    expect(
      checkTts('qwen-audio-3.1-tts-flash', { text: 'hi', voice: 'v', parameters: { text: 'x' } }),
    ).toMatch(/must not override/)
    expect(
      checkTts(
        'qwen-audio-3.1-tts-flash',
        { text: 'hi', voice: 'v', parameters: { format: 'mp3' } },
        'local',
      ),
    ).toMatch(/WAV/)
  })
  it('rejects realtime models and instructions on qwen3-tts-flash', () => {
    expect(checkTts('qwen3-tts-realtime', { text: 'hi', voice: 'v' })).toMatch(/Only/)
    expect(checkTts('qwen3-tts-flash', { text: 'hi', voice: 'v', instructions: 'soft' })).toMatch(
      /does not support/,
    )
  })
  it('accepts a valid synthesizer request', () => {
    expect(
      checkTts('qwen-audio-3.1-tts-flash', { text: 'hi', voice: 'v', language: 'zh' }),
    ).toBeNull()
  })
})

describe('parseTtsResponse / parseUsage / audioFile / choiceContents', () => {
  it('parses audio.url, request_id and usage', () => {
    const f = fixture('tts-synthesizer')
    expect(parseTtsResponse(f.response.body)).toEqual({
      url: 'https://example.com/tts.wav',
      requestId: 'req-tts-1',
      usage: { characters: 5 },
    })
  })
  it('throws when audio.url is missing', () => {
    expect(() => parseTtsResponse({ output: {} })).toThrow(ProviderError)
  })
  it('normalizes all usage counters', () => {
    expect(
      parseUsage({
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          image_count: 3,
          characters: 4,
          duration: 5,
        },
      }),
    ).toEqual({ inputTokens: 1, outputTokens: 2, images: 3, characters: 4, seconds: 5 })
    expect(
      parseUsage({ usage: { prompt_tokens: 7, completion_tokens: 8, output_image_count: 9 } }),
    ).toEqual({
      inputTokens: 7,
      outputTokens: 8,
      images: 9,
    })
  })
  it('audioFile upgrades http to https', () => {
    expect(audioFile({ output: { audio: { url: 'http://example.com/a.wav' } } })).toMatchObject({
      url: 'https://example.com/a.wav',
      kind: 'audio',
    })
    expect(() => audioFile({ output: {} })).toThrow(ProviderError)
  })
  it('choiceContents flattens content parts', () => {
    expect(
      choiceContents({ output: { choices: [{ message: { content: [{ image: 'u' }] } }] } }),
    ).toEqual([{ image: 'u' }])
  })
})

describe('synthesizeQwenAudioTts (recorded fixtures)', () => {
  it('builds the SpeechSynthesizer request and parses the response', async () => {
    const f = fixture('tts-synthesizer')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await synthesizeQwenAudioTts(ctx, {
      text: '你好，世界。',
      model: 'qwen-audio-3.1-tts-flash',
      voice: 'qwen-audio-3.1-tts-flash-custom',
      instructions: '用温柔的语气',
      language: 'zh',
    })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.url).toBe('https://example.com/tts.wav')
  })
  it('builds the legacy qwen3-tts request', async () => {
    const f = fixture('tts-qwen')
    const { ctx, calls } = fakeContext([f.response.body])
    await synthesizeQwenAudioTts(ctx, {
      text: '测试文本',
      model: 'qwen3-tts-flash',
      voice: 'Cherry',
      language: 'Auto',
    })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
  })
  it('rejects empty text, multi-chunk text and invalid options', async () => {
    const { ctx } = fakeContext([])
    await expect(synthesizeQwenAudioTts(ctx, { text: '' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(synthesizeQwenAudioTts(ctx, { text: '啊'.repeat(300) })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      synthesizeQwenAudioTts(ctx, {
        text: 'hi',
        model: 'qwen-audio-3.1-tts-flash',
        language: 'Chinese',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
