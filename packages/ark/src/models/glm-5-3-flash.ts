import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/glm-5.3-flash',
  id: 'glm-5.3-flash',
  title: 'glm-5.3-flash',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured', 'vision'],
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'glm-5.3-flash' }],
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
