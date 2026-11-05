import type { ModelDeclaration } from '@modelbay/core'

/**
 * CosyVoice 3 Flash
 *
 * CosyVoice 3 Flash：复刻与设计音色支持自然语言指令（不超过 100 字符，汉字按 2 计）。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/cosyvoice-v3-flash',
  id: 'cosyvoice-v3-flash',
  title: 'CosyVoice 3 Flash',
  description:
    'CosyVoice 3 Flash：复刻与设计音色支持自然语言指令（不超过 100 字符，汉字按 2 计）。',
  capabilities: ['audio.speech'],
  limits: {
    instruction: true,
    speed: {
      min: 0.5,
      max: 2,
    },
    speech: {
      instructionMaxLength: 100,
      voiceClone: true,
      voiceDesign: true,
      cloneLanguages: ['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'th', 'id', 'vi'],
      clonePreprocess: true,
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'cosyvoice-v3-flash',
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
