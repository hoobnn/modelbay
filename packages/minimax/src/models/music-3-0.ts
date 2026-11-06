import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/music-3.0',
  id: 'music-3.0',
  title: 'Music 3.0',
  capabilities: ['audio.music'],
  description: '2026-08-20 起不再向新用户开放，仅历史付费用户可用；免费版已停服',
  limits: { duration: false, promptMaxLength: 2000 },
  channels: [{ channel: 'minimax', id: 'music-3.0' }],
  aliases: { official: [], short: [] },
  // 官方原文（2026-11-06）：| music-3.0 | 音乐 | 已下线 |
  lifecycle: {
    status: 'retired',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-06' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
