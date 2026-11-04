import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/MiniMax-M2.7',
  id: 'MiniMax-M2.7',
  title: 'MiniMax M2.7（纯文本）',
  capabilities: ['text.chat'],
  description: '已停止向新用户开放；按量付费存量用户可调用至 2026-11-18，请提前迁移至 M3.1 Flash',
  features: ['structured'],
  channels: [{ channel: 'minimax', id: 'MiniMax-M2.7' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
