import type { ModelDeclaration } from '@modelbay/core'

/**
 * Qwen-Audio-TTS 3.1 Flash
 *
 * 官方推荐的实时交互模型：语音助手、实时对话、智能客服。支持系统音色、声音复刻、声音设计、自然语言指令与情感富语言标签。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.1-tts-flash',
  id: 'qwen-audio-3.1-tts-flash',
  title: 'Qwen-Audio-TTS 3.1 Flash',
  description:
    '官方推荐的实时交互模型：语音助手、实时对话、智能客服。支持系统音色、声音复刻、声音设计、自然语言指令与情感富语言标签。',
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
      otherLanguage: true,
      defaultVoice: 'longanhuan_v3.1',
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'qwen-audio-3.1-tts-flash',
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
  default: true,
} satisfies ModelDeclaration
