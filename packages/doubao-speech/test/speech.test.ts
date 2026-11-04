import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  buildSpeechRequest,
  customVoiceId,
  decodeAudioStream,
  parseResponseBody,
  pcmWav,
  resolveSpeechSettings,
  speechSettings,
  synthesizeSpeech,
  text,
  TTS_VOICES,
  type SpeechSettings,
} from '../src/speech'
import { fakeContext, fixture, fixtureReply } from './helpers'

const settings: SpeechSettings = {
  voice: 'zh_female_vv_uranus_bigtts',
  format: 'mp3',
  sampleRate: '24000',
  speed: 1,
}

describe('speechSettings / resolveSpeechSettings / TTS_VOICES', () => {
  it('exposes .shape and applies defaults', () => {
    expect(Object.keys(speechSettings.shape)).toEqual(['voice', 'format', 'sampleRate', 'speed'])
    expect(speechSettings.parse({})).toEqual(settings)
    expect(speechSettings.parse({ format: 'wav' }).format).toBe('wav')
  })
  it('resolves overrides and host-managed secrets', () => {
    const plain = fakeContext().ctx
    expect(resolveSpeechSettings(plain)).toEqual(settings)
    expect(resolveSpeechSettings(plain, { format: 'wav' }).format).toBe('wav')
    const configured = fakeContext([], {
      secrets: {
        VOLC_SPEECH_API_KEY: 'k',
        VOLC_SPEECH_VOICE: 'zh_male_m191_uranus_bigtts',
        VOLC_SPEECH_FORMAT: 'wav',
      },
    }).ctx
    expect(resolveSpeechSettings(configured)).toMatchObject({
      voice: 'zh_male_m191_uranus_bigtts',
      format: 'wav',
    })
  })
  it('TTS_VOICES is exported for the ark package', () => {
    expect(TTS_VOICES.length).toBeGreaterThan(10)
    expect(TTS_VOICES[0]).toMatchObject({ id: 'zh_female_vv_uranus_bigtts', gender: 'female' })
    expect(TTS_VOICES.every((voice) => typeof voice.id === 'string' && voice.title)).toBe(true)
  })
})

describe('text / customVoiceId', () => {
  it('text validates length', () => {
    expect(text('hi', 'Text')).toBe('hi')
    expect(() => text('', 'Text')).toThrow(ProviderError)
    expect(() => text('x'.repeat(3001), 'Text')).toThrow(ProviderError)
  })
  it('customVoiceId recognises custom ids but not presets/slots', () => {
    expect(customVoiceId('MyCustomVoice_1')).toBe(true)
    expect(customVoiceId('S_slot')).toBe(false)
    expect(customVoiceId('zh_female_vv_uranus_bigtts')).toBe(false)
  })
})

describe('buildSpeechRequest', () => {
  it('builds the recorded unidirectional request', () => {
    const built = buildSpeechRequest('seed-tts-2.0', { text: '你好' }, settings)
    expect(built.path).toBe('/api/v3/tts/unidirectional')
    expect(built.resource).toBe('seed-tts-2.0')
    expect(built.body).toEqual(fixture('tts-success').request.body)
  })
  it('uses the plan endpoint and rejects custom voices in plan mode', () => {
    expect(buildSpeechRequest('seed-tts-2.0', { text: '你好' }, settings, true).path).toBe(
      '/api/v3/plan/tts/unidirectional',
    )
    expect(() =>
      buildSpeechRequest('seed-tts-2.0', { text: '你好', voice: 'S_slot' }, settings, true),
    ).toThrow(ProviderError)
  })
  it('selects the clone resource for custom voices', () => {
    expect(
      buildSpeechRequest('seed-icl-2.0', { text: '你好', voice: 'MyCustomVoice_1' }, settings)
        .resource,
    ).toBe('seed-icl-2.0')
    expect(() => buildSpeechRequest('seed-icl-2.0', { text: '你好' }, settings)).toThrow(
      ProviderError,
    )
  })
  it('validates speed and includes instruction in additions', () => {
    expect(() => buildSpeechRequest('seed-tts-2.0', { text: 'hi', speed: 3 }, settings)).toThrow(
      ProviderError,
    )
    const built = buildSpeechRequest('seed-tts-2.0', { text: 'hi', instruction: '温柔' }, settings)
    expect((built.body.req_params as Record<string, unknown>).additions).toBe(
      JSON.stringify({ context_texts: ['温柔'] }),
    )
  })
})

describe('decodeAudioStream / pcmWav / parseResponseBody', () => {
  const ctx = fakeContext().ctx
  it('decodes chunked base64 audio and requires the end marker', () => {
    const raw = fixture('tts-success').response.text!
    expect([...decodeAudioStream(raw, 'data', ctx, settings, true)]).toEqual([1, 2, 3])
    expect(() =>
      decodeAudioStream('{"code":0,"data":"AQID"}', 'data', ctx, settings, true),
    ).toThrow(ProviderError)
  })
  it('rejects invalid base64 and packet errors', () => {
    expect(() => decodeAudioStream('{"code":0,"data":"!!!"}', 'data', ctx, settings)).toThrow(
      ProviderError,
    )
    expect(() =>
      decodeAudioStream('{"code":45000001,"message":"bad"}', 'data', ctx, settings),
    ).toThrow(ProviderError)
    expect(() => decodeAudioStream('{"code":0}', 'data', ctx, settings)).toThrow(ProviderError)
  })
  it('wraps PCM in a RIFF/WAVE container for wav format', () => {
    const wav = decodeAudioStream(
      '{"code":20000000,"data":"AQIDBA=="}',
      'data',
      ctx,
      { ...settings, format: 'wav' },
      true,
    )
    expect(wav.length).toBe(48)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(() => pcmWav(new Uint8Array([1]), 24000)).toThrow(ProviderError)
  })
  it('parseResponseBody unwraps data and rejects business codes', () => {
    expect(parseResponseBody('{"code":0,"data":{"status":2}}', ctx)).toEqual({ status: 2 })
    expect(() => parseResponseBody('{"header":{"code":45000001,"message":"bad"}}', ctx)).toThrow(
      ProviderError,
    )
    expect(() => parseResponseBody('not-json', ctx)).toThrow(ProviderError)
  })
})

describe('synthesizeSpeech (the ark-facing export)', () => {
  it('builds the recorded request and returns a file output', async () => {
    const f = fixture('tts-success')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const result = await synthesizeSpeech('seed-tts-2.0', { text: '你好' }, ctx)
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.state).toBe('succeeded')
    expect(result.state === 'succeeded' && result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
      mime: 'audio/mpeg',
    })
    expect([
      ...(result.state === 'succeeded' ? (result.outputs[0] as { data: Uint8Array }).data : []),
    ]).toEqual([1, 2, 3])
  })
  it('uses the plan endpoint when plan=true', async () => {
    const { ctx, calls } = fakeContext([fixtureReply(fixture('tts-success'))])
    await synthesizeSpeech('seed-tts-2.0', { text: '你好' }, ctx, true)
    expect(calls()[0]?.url).toContain('/api/v3/plan/tts/unidirectional')
  })
})
