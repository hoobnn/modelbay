import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3.7-text-embedding-flash：百炼的文本向量化模型，走与 text-embedding-v4 相同的 OpenAI 兼容接口（/compatible-mode/v1/embeddings）。
 *
 * 来源（2026-11-11 核对）：https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
 * 兼容接口的成功响应示例标题为「qwen3.7-text-embedding-flash 成功响应」；维度见
 * https://help.aliyun.com/zh/model-studio/qwen3-7-text-embedding-flash「支持256、512、768、1024维…，默认1024维」。
 */
export default {
  canonicalId: 'aliyun/qwen3.7-text-embedding-flash',
  id: 'qwen3.7-text-embedding-flash',
  title: 'qwen3.7-text-embedding-flash',
  description:
    '轻量文本向量化：dimensions 可选 256 / 512 / 768 / 1024（默认 1024），单次最多 20 条。',
  capabilities: ['text.embed'],
  channels: [{ channel: 'bailian', id: 'qwen3.7-text-embedding-flash' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/embedding-rerank-model',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
