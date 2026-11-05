import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/minimax-m3',
  id: 'minimax-m3',
  title: 'minimax-m3',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured'],
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'minimax-m3' }],
  aliases: { official: [], short: [] },
  // 弃用状态（sunsetting，仍可运行）沿用 plein 原目录的判断（deprecated: true，置后）；官方公告原文没读到，
  // checkedAt 取 plein 打该标记的提交日期，不是本仓库核对正文的日期。
  lifecycle: {
    status: 'sunsetting',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-01',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-04',
  },
} satisfies ModelDeclaration
