import type { ModelDeclaration } from '@modelbay/core'

/**
 * CosyVoice 3 Plus
 *
 * CosyVoice 3 Plus：复刻与设计音色的指令控制按音色列表的固定格式填写，不支持自然语言指令。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/cosyvoice-v3-plus',
  id: 'cosyvoice-v3-plus',
  title: 'CosyVoice 3 Plus',
  description:
    'CosyVoice 3 Plus：复刻与设计音色的指令控制按音色列表的固定格式填写，不支持自然语言指令。',
  capabilities: ['audio.speech'],
  limits: {
    instruction: false,
    speed: {
      min: 0.5,
      max: 2,
    },
    speech: {
      voiceClone: true,
      voiceDesign: true,
      cloneLanguages: ['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru'],
      clonePreprocess: false,
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'cosyvoice-v3-plus',
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
