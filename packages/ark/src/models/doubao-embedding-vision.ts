import type { ModelDeclaration } from '@modelbay/core'

/**
 * 豆包向量模型：文本与多模态（图文）向量化。
 *
 * 按量渠道用日期快照 ID，套餐渠道用不带日期的 ID（官方「套餐概览」页只列后者）。
 *
 * 来源：https://docs.volcengine.com/docs/ark/model-list?lang=zh 与
 * https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview（2026-11-05 核对）
 */
export default {
  canonicalId: 'volc/doubao-embedding-vision',
  id: 'doubao-embedding-vision',
  title: 'doubao-embedding-vision',
  description: '豆包向量模型：文本与多模态向量化。',
  capabilities: ['text.embed'],
  channels: [
    { channel: 'ark', id: 'doubao-embedding-vision-251215' },
    { channel: 'ark-plan', id: 'doubao-embedding-vision' },
  ],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
