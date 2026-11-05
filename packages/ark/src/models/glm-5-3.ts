import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/glm-5.3',
  id: 'glm-5.3',
  title: 'glm-5.3',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured'],
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'glm-5.3' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
