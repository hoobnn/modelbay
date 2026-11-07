import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/MiniMax-M3.1-Flash',
  id: 'MiniMax-M3.1-Flash',
  title: 'MiniMax M3.1 Flash',
  capabilities: ['text.chat'],
  features: ['vision', 'structured'],
  // 上下文窗口：https://platform.minimaxi.com/docs/guides/text-generation
  // 模型表「MiniMax-M3.1-Flash」行，上下文窗口写 1,000,000，2026-11-07 核对原文。
  // 最大输出：https://platform.minimaxi.com/docs/api-reference/text-chat
  // max_completion_tokens 参数说明写「MiniMax-M3.1-Flash 和 MiniMax-M3 推荐值为 131072（128K），上限为 524288（512K）」，
  // 取上限 524288，2026-11-07 核对原文。
  contextWindow: 1000000,
  maxOutputTokens: 524288,
  channels: [{ channel: 'minimax', id: 'MiniMax-M3.1-Flash' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
