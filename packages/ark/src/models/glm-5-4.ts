import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/glm-5.4',
  id: 'glm-5.4',
  title: 'glm-5.4',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  // 套餐文档没有列出这个模型的能力，不声明对话特性。
  // 上下文窗口与最大输出：https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview
  // 「支持模型及 Harness」表，长度限制写「上下文窗口：1024K」「最大输出：128K」，2026-11-24 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 128000,
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'glm-5.4' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    // 同一张表里 glm-5.4 没有「即将下线」标记（kimi-k3 才有），2026-11-24 核对原文。
    status: 'active',
    source: {
      url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
      checkedAt: '2026-11-24',
    },
  },
  source: {
    url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
    checkedAt: '2026-11-24',
  },
} satisfies ModelDeclaration
