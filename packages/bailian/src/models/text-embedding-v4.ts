import type { ModelDeclaration } from '@modelbay/core'

/**
 * text-embedding-v4：百炼的文本向量化模型。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/embedding-rerank-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/text-embedding-v4',
  id: 'text-embedding-v4',
  title: 'text-embedding-v4',
  description: '文本向量化：把文本编码成向量，供检索与聚类使用。',
  capabilities: ['text.embed'],
  channels: [{ channel: 'bailian', id: 'text-embedding-v4' }],
  aliases: { official: [], short: [] },
  default: true,
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
