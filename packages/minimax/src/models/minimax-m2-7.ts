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
    status: 'sunsetting',
    // 官方原文（2026-11-05）：停止向新用户开放调用：【2026年10月19日】；正式下线：【2026年11月18日】
    sunsetOn: '2026-11-18',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
