import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seed-2-1-pro-260915',
  id: 'doubao-seed-2-1-pro-260915',
  title: 'Doubao Seed 2.1 Pro（260915）',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  channels: [{ channel: 'ark', id: 'doubao-seed-2-1-pro-260915' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-04',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-04',
  },
} satisfies ModelDeclaration
