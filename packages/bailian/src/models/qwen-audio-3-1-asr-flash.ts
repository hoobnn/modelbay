import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen-audio-3.1-asr-flash：百炼的非实时语音识别模型，走 DashScope 原生多模态生成接口（与 Qwen3-ASR-Flash 的
 * OpenAI 兼容接口不同）。
 *
 * 来源（2026-11-11 核对）：
 * - https://help.aliyun.com/zh/model-studio/asr-model「5分钟 / 2GB」「URL / Base64，单次 1 个」，支持说话人分离，
 *   不支持情感识别
 * - https://help.aliyun.com/zh/model-studio/qwen-audio-asr-http-api：parameters.format 必选，
 *   speaker_diarization_enabled / keep_dialect「仅适用于 qwen-audio-3.1-asr-flash」，language_hints、vocabulary
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.1-asr-flash',
  id: 'qwen-audio-3.1-asr-flash',
  title: 'Qwen-Audio-ASR 3.1 Flash',
  description:
    '非实时语音识别：单段 5 分钟内，自带文本润色，支持说话人分离、保留方言、热词，返回带时间戳的句子。',
  capabilities: ['audio.transcribe'],
  channels: [
    {
      channel: 'bailian',
      id: 'qwen-audio-3.1-asr-flash',
      endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
    },
  ],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/asr-model', checkedAt: '2026-11-11' },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/qwen-audio-asr-http-api',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
