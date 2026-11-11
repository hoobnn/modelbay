import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3.7-text-embedding：百炼的文本向量化模型，走与 text-embedding-v4 相同的 OpenAI 兼容接口（/compatible-mode/v1/embeddings）。
 *
 * 来源（2026-11-11 核对）：https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
 * 「dimensions」写「2560（仅适用于qwen3.7-text-embedding）」及 2048 / 1536 / 1024（默认）/ 768 / 512 / 256；
 * 单次最多 20 行，单行最长 128,000 Token（总览页写 131072）。
 */
export default {
  canonicalId: 'aliyun/qwen3.7-text-embedding',
  id: 'qwen3.7-text-embedding',
  title: 'qwen3.7-text-embedding',
  description:
    '文本向量化：多语言统一向量模型，dimensions 可选 256–2560（默认 1024），单次最多 20 条。',
  capabilities: ['text.embed'],
  channels: [{ channel: 'bailian', id: 'qwen3.7-text-embedding' }],
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
