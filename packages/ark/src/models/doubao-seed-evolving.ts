import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seed-evolving',
  id: 'doubao-seed-evolving',
  title: 'Doubao Seed Evolving（快速迭代）',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  channels: [
    { channel: 'ark', id: 'doubao-seed-evolving' },
    {
      channel: 'ark-plan',
      id: 'doubao-seed-evolving',
      agentOnly: true,
      source: {
        url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
        checkedAt: '2026-11-05',
      },
    },
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
