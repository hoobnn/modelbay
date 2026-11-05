import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3.7-text-rerank：百炼的文本重排序模型。
 *
 * 重排序在 0003 里没有对应的归一化能力，按规定走 native（rerank）；
 * 声明里照样要有这个模型，能力取最接近的 text.embed。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/embedding-rerank-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/qwen3.7-text-rerank',
  id: 'qwen3.7-text-rerank',
  title: 'qwen3.7-text-rerank',
  description: '文本重排序：按与查询的相关性给候选文档打分排序。',
  capabilities: ['text.embed'],
  native: ['rerank'],
  channels: [{ channel: 'bailian', id: 'qwen3.7-text-rerank' }],
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
