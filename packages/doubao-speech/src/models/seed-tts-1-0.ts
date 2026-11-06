import type { ModelDeclaration } from '@modelbay/core'

/**
 * seed-tts-1.0：豆包语音合成大模型 1.0 代际。
 *
 * 官方接口文档当前只列 2.0 代际的资源 ID（seed-tts-2.0 / seed-icl-2.0）；
 * 1.0 只留给历史音色（_moon_bigtts / _mars_bigtts / BV 前缀）继续合成。
 *
 * 来源：https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http（2026-11-05 核对）
 */
export default {
  canonicalId: 'doubao/seed-tts-1.0',
  id: 'seed-tts-1.0',
  title: 'seed-tts-1.0',
  description: '1.0 代际语音合成：官方接口文档当前只列 2.0 代际资源 ID，仅历史音色继续使用。',
  capabilities: ['audio.speech'],
  // 采样率：https://docs.volcengine.com/docs/6561/1598757 req_params.audio_params.sample_rate（2026-11-06 核对）
  limits: { sampleRates: [8000, 16000, 22050, 24000, 32000, 44100, 48000] },
  channels: [{ channel: 'doubao-speech', id: 'seed-tts-1.0' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
