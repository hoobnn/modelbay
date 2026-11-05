import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-tts-flash：走 multimodal-generation 协议的非实时 TTS。
 *
 * 只支持系统音色，不支持复刻、设计与自然语言指令；单次输入不超过 600 字符。
 * 音色列表来源：https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list（2026-11-05 核对）
 * 接口参数来源：https://help.aliyun.com/zh/model-studio/qwen-tts-api（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen3-tts-flash',
  id: 'qwen3-tts-flash',
  title: 'qwen3-tts-flash',
  description:
    'Qwen3-TTS 非实时合成：只支持系统音色，不支持声音复刻、声音设计与自然语言指令；单次输入不超过 600 字符。',
  capabilities: ['audio.speech'],
  limits: {
    instruction: false,
    speed: false,
    promptMaxLength: 600,
    speech: {
      voiceClone: false,
      voiceDesign: false,
      defaultVoice: 'Cherry',
    },
  },
  voices: [
    { id: 'Cherry', title: '芊悦', gender: 'female' },
    { id: 'Serena', title: '苏瑶', gender: 'female' },
    { id: 'Ethan', title: '晨煦', gender: 'male' },
    { id: 'Chelsie', title: '千雪', gender: 'female' },
    { id: 'Momo', title: '茉兔', gender: 'female' },
    { id: 'Vivian', title: '十三', gender: 'female' },
    { id: 'Moon', title: '月白', gender: 'male' },
    { id: 'Neil', title: '阿闻', gender: 'male' },
    { id: 'Arthur', title: '徐大爷', gender: 'male' },
  ],
  channels: [
    {
      channel: 'bailian',
      id: 'qwen3-tts-flash',
      endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
    },
  ],
  aliases: { official: [], short: ['flash'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/tts-model',
      checkedAt: '2026-11-05',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/tts-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
