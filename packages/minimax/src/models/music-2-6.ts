import type { ModelDeclaration } from '@modelbay/core'

/**
 * Music 2.6：MiniMax 的历史音乐模型。
 *
 * 官方「模型列表」页把 music-3.0 / music-2.6 / music-cover 都列在「历史模型」里，
 * 状态是「已下线」；付费接口自 2026-08-20 起不再向新用户开放，历史付费用户可继续使用。
 * 来源：https://platform.minimax.cn/docs/faq/models（2026-11-05 核对）
 */
export default {
  canonicalId: 'minimax/music-2.6',
  id: 'music-2.6',
  title: 'Music 2.6',
  description: '历史音乐模型：官方模型列表页已列入「历史模型（已下线）」，仅存量付费用户可用。',
  capabilities: ['audio.music'],
  limits: { duration: false, promptMaxLength: 2000 },
  channels: [{ channel: 'minimax', id: 'music-2.6' }],
  aliases: { official: [], short: [] },
  // 官方原文（2026-11-06）：| music-2.6 | 音乐 | 已下线 |
  lifecycle: {
    status: 'retired',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-06' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
