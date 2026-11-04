import { describe, expect, it } from 'vite-plus/test'
import * as doubao from '@modelbay/doubao-speech'
import { fakeContext, fixture, fixtureReply } from './helpers'

describe('root entry (the ark-facing cross-adapter API)', () => {
  it('exports doubaoAdapter, speechSettings, synthesizeSpeech and TTS_VOICES', () => {
    expect(doubao.doubaoAdapter.id).toBe('doubao/speech')
    expect(doubao.doubaoAdapter.models.length).toBeGreaterThan(0)
    expect(doubao.speechSettings.parse({}).voice).toBe('zh_female_vv_uranus_bigtts')
    expect(typeof doubao.synthesizeSpeech).toBe('function')
    expect(doubao.TTS_VOICES.length).toBeGreaterThan(10)
  })
  it('synthesizeSpeech works with plan=true (ark Agent Plan signature)', async () => {
    const { ctx } = fakeContext([fixtureReply(fixture('tts-success'))])
    const result = await doubao.synthesizeSpeech('seed-tts-2.0', { text: '你好' }, ctx, true)
    expect(result.state).toBe('succeeded')
  })
})
