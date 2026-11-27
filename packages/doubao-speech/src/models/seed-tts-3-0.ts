import type { ModelDeclaration } from '@modelbay/core'

const source = {
  url: 'https://docs.volcengine.com/docs/doubao-voice/seed-tts-3-0-http-streaming',
  checkedAt: '2026-11-27',
}

/**
 * 豆包语音合成 3.0：独立接口（voice.cn-beijing.volces.com），请求与响应格式都和 2.0 不同，
 * 见 speech.ts 的 buildSpeech3Request / decodeSpeech3Stream。
 */
export default {
  canonicalId: 'doubao/seed-tts-3.0',
  id: 'doubao-seed-tts-3.0',
  title: '豆包语音合成 3.0',
  capabilities: ['audio.speech'],
  limits: {
    speed: { min: 0.5, max: 2 },
    promptMaxLength: 10000,
    sampleRates: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
    speech: {
      // 采用官方 HTTP 请求示例的通用音色作为 Modelbay 默认音色。
      defaultVoice: 'multi_female_tuanzi_v3_uranus_bigtts',
      volume: { min: 0.5, max: 2 },
      pitch: { min: -12, max: 12 },
    },
  },
  // 3.0 音色列表「通用场景」：https://docs.volcengine.com/docs/doubao-voice/voice-list-3-0-1（2026-11-27 核对）
  voices: [
    { id: 'multi_female_tuanzi_v3_uranus_bigtts', title: '团子 3.0', gender: 'female' },
    { id: 'multi_male_taocheng_v3_uranus_bigtts', title: '小天 3.0', gender: 'male' },
    { id: 'multi_male_m191_v3_uranus_bigtts', title: '云舟 3.0', gender: 'male' },
    { id: 'multi_female_zhixingnv_v3_uranus_bigtts', title: '知性女声 3.0', gender: 'female' },
    { id: 'multi_female_xinlingjitang_v3_uranus_bigtts', title: '心灵鸡汤 3.0', gender: 'female' },
    { id: 'multi_male_jamie_v3_uranus_bigtts', title: 'Jamie 3.0', gender: 'male' },
    { id: 'multi_female_wenrouxiaoya_v3_uranus_bigtts', title: '温柔小雅 3.0', gender: 'female' },
    { id: 'multi_male_youyoujunzi_v3_uranus_bigtts', title: '悠悠君子 3.0', gender: 'male' },
    { id: 'multi_female_wenroushunv_v3_uranus_bigtts', title: '温柔淑女 3.0', gender: 'female' },
    { id: 'multi_male_yangguangqingnian_v3_uranus_bigtts', title: '阳光青年 3.0', gender: 'male' },
  ],
  // model_id「默认 doubao-seed-tts-3.0」
  channels: [{ channel: 'doubao-speech', id: 'doubao-seed-tts-3.0' }],
  aliases: { official: [], short: [] },
  lifecycle: { status: 'active', source },
  source,
} satisfies ModelDeclaration
