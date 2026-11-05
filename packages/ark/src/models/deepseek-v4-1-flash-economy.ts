import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/deepseek-v4.1-flash-economy',
  id: 'deepseek-v4.1-flash-economy',
  title: 'deepseek-v4.1-flash-economy',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured', 'vision'],
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'deepseek-v4.1-flash-economy' }],
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
