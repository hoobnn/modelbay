import type { ModelDeclaration } from '@modelbay/core'

/**
 * Qwen-Audio-TTS 3.0 Plus
 *
 * 3.1 Plus 的上一代，官方已推荐升级到 qwen-audio-3.1-tts-plus。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.0-tts-plus',
  id: 'qwen-audio-3.0-tts-plus',
  title: 'Qwen-Audio-TTS 3.0 Plus',
  description: '3.1 Plus 的上一代，官方已推荐升级到 qwen-audio-3.1-tts-plus。',
  capabilities: ['audio.speech'],
  limits: {
    instruction: true,
    speed: {
      min: 0.5,
      max: 2,
    },
    speech: {
      voiceClone: true,
      voiceDesign: true,
      cloneLanguages: [
        'zh',
        'en',
        'fr',
        'de',
        'ja',
        'ko',
        'ru',
        'pt',
        'th',
        'id',
        'vi',
        'it',
        'es',
        'ms',
        'fil',
        'ar',
      ],
      clonePreprocess: true,
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'qwen-audio-3.0-tts-plus',
      endpoint: '/api/v1/services/audio/tts/SpeechSynthesizer',
    },
  ],
  aliases: { official: [], short: ['audio-plus'] },
  lifecycle: {
    status: 'superseded',
    by: 'qwen-audio-3.1-tts-plus',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/tts-model',
      checkedAt: '2026-11-05',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/tts-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
