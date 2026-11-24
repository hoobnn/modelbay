import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seed-2.1-pro',
  id: 'doubao-seed-2.1-pro',
  title: 'doubao-seed-2.1-pro',
  capabilities: ['text.chat'],
  description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
  features: ['tools', 'structured', 'vision'],
  // 上下文窗口与最大输出：https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview
  // 「支持模型及 Harness」表，长度限制写「上下文窗口：1024k」「最大输出：256k」，2026-11-07 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 256000,
  // 最大输入：套餐概览页只写上下文窗口与最大输出，同一模型的按量列表页
  // https://docs.volcengine.com/docs/ark/model-list?lang=zh
  // 「doubao-seed-2-1-pro-260915」行写「最大输入: 1024k」，2026-11-14 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（224k 记 224000）。
  maxInputTokens: 1024000,
  agentOnly: true,
  default: true,
  channels: [{ channel: 'ark-plan', id: 'doubao-seed-2.1-pro' }],
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
