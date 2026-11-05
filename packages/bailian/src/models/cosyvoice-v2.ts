import type { ModelDeclaration } from '@modelbay/core'

/**
 * CosyVoice v2
 *
 * CosyVoice v2：只支持复刻音色，不支持设计音色、自然语言指令与音频预处理参数。
 * 来源：https://help.aliyun.com/zh/model-studio/tts-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/cosyvoice-v2',
  id: 'cosyvoice-v2',
  title: 'CosyVoice v2',
  description: 'CosyVoice v2：只支持复刻音色，不支持设计音色、自然语言指令与音频预处理参数。',
  capabilities: ['audio.speech'],
  limits: {
    instruction: false,
    speed: {
      min: 0.5,
      max: 2,
    },
    speech: {
      voiceClone: true,
      voiceDesign: false,
      clonePreprocess: false,
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'cosyvoice-v2',
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
