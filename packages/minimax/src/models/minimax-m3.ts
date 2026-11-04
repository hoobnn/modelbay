import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/MiniMax-M3',
  id: 'MiniMax-M3',
  title: 'MiniMax M3',
  capabilities: ['text.chat'],
  features: ['vision', 'structured'],
  channels: [{ channel: 'minimax', id: 'MiniMax-M3' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
