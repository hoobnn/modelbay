import type { ModelDeclaration } from '@modelbay/core'

/**
 * Qwen-Audio-TTS 3.1 Plus
 *
 * 官方推荐的内容制作模型：有声书、影视配音、品牌声音与内容制作。支持系统音色、声音复刻、声音设计与自然语言指令。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.1-tts-plus',
  id: 'qwen-audio-3.1-tts-plus',
  title: 'Qwen-Audio-TTS 3.1 Plus',
  description:
    '官方推荐的内容制作模型：有声书、影视配音、品牌声音与内容制作。支持系统音色、声音复刻、声音设计与自然语言指令。',
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
      id: 'qwen-audio-3.1-tts-plus',
      endpoint: '/api/v1/services/audio/tts/SpeechSynthesizer',
    },
  ],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/tts-model',
      checkedAt: '2026-11-05',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/tts-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
