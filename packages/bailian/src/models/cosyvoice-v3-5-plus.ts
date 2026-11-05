import type { ModelDeclaration } from '@modelbay/core'

/**
 * CosyVoice 3.5 Plus
 *
 * CosyVoice 3.5 Plus：支持复刻音色、设计音色与自然语言指令（指令不超过 100 字符，汉字按 2 计）。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/cosyvoice-v3.5-plus',
  id: 'cosyvoice-v3.5-plus',
  title: 'CosyVoice 3.5 Plus',
  description:
    'CosyVoice 3.5 Plus：支持复刻音色、设计音色与自然语言指令（指令不超过 100 字符，汉字按 2 计）。',
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
      id: 'cosyvoice-v3.5-plus',
      endpoint: '/api/v1/services/audio/tts/SpeechSynthesizer',
    },
  ],
  aliases: { official: [], short: ['cosyvoice'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/tts-model',
      checkedAt: '2026-11-05',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/tts-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
