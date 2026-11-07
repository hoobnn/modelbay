import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/deepseek-v4.1-flash',
  id: 'deepseek-v4.1-flash',
  title: 'deepseek-v4.1-flash',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured', 'vision'],
  // 上下文窗口与最大输出：https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview
  // 「支持模型及 Harness」表，长度限制写「上下文窗口：1024k」「最大输出：384k」，2026-11-07 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 384000,
  agentOnly: true,
  channels: [{ channel: 'ark-plan', id: 'deepseek-v4.1-flash' }],
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
    checkedAt: '2026-11-07',
  },
} satisfies ModelDeclaration
