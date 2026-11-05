import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-vl-embedding：百炼的多模态向量化模型（图文一起编码）。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/embedding-rerank-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen3-vl-embedding',
  id: 'qwen3-vl-embedding',
  title: 'qwen3-vl-embedding',
  description: '多模态向量化：图片与文本一起编码成向量。',
  capabilities: ['text.embed'],
  channels: [{ channel: 'bailian', id: 'qwen3-vl-embedding' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/embedding-rerank-model',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/embedding-rerank-model',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
