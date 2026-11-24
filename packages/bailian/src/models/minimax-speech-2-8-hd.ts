import type { ModelDeclaration } from '@modelbay/core'
/**
 * 百炼转售的 MiniMax 语音合成模型。
 *
 * 走百炼的多模态生成接口，请求体用 `input.voice_setting`，返回的音频是 hex 而不是链接，
 * 所以渠道上用 `protocol: 'minimax'` 指明这一形态。
 * 来源：https://help.aliyun.com/zh/model-studio/speech-2-8-hd（2026-11-14 核对原文）
 */
export default {
  canonicalId: 'aliyun/minimax-speech-2.8-hd',
  id: 'MiniMax/speech-2.8-hd',
  title: 'MiniMax speech-2.8-hd',
  description:
    'MiniMax speech-2.8-hd：百炼转售的 MiniMax 语音合成模型，音色用 voice_setting.voice_id 指定，官方单价 3.5 元/万字符。',
  capabilities: ['audio.speech'],
  limits: {
    // 官方没有自然语言指令这一说，情绪用 voice_setting.emotion 传
    instruction: false,
    speed: { min: 0.5, max: 2 },
    // 官方请求体写「长度限制小于 10000 字符」，按上限取 9999
    promptMaxLength: 9999,
    // 复刻与设计走百炼自己的声音注册接口，官方没写明 MiniMax 能不能当目标模型，先不开放
    speech: { voiceClone: false, voiceDesign: false },
  },
  optionsSchema: {
    type: 'object',
    properties: {
      speed: { title: '语速', type: 'number', minimum: 0.5, maximum: 2 },
      vol: { title: '音量', type: 'number', exclusiveMinimum: 0, maximum: 10 },
      pitch: { title: '音高', type: 'integer', minimum: -12, maximum: 12 },
      emotion: {
        title: '情绪',
        type: 'string',
        enum: ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'],
      },
    },
  },
  channels: [
    {
      channel: 'bailian',
      id: 'MiniMax/speech-2.8-hd',
      endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
      protocol: 'minimax',
    },
  ],
  aliases: { official: [], short: ['mm-hd'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/speech-2-8-hd',
      checkedAt: '2026-11-14',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/speech-2-8-hd', checkedAt: '2026-11-14' },
} satisfies ModelDeclaration
