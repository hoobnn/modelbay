import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-asr-flash：百炼的非实时语音识别模型（HTTP）。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/asr-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen3-asr-flash',
  id: 'qwen3-asr-flash',
  title: 'Qwen3-ASR-Flash',
  description: '非实时语音识别：HTTP 接口，转写音频为文本。',
  capabilities: ['audio.transcribe'],
  channels: [{ channel: 'bailian', id: 'qwen3-asr-flash' }],
  aliases: { official: [], short: [] },
  default: true,
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/asr-model', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/asr-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
