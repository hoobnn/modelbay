import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/deepseek-v4-flash',
  id: 'deepseek-v4-flash',
  title: 'deepseek-v4-flash',
  capabilities: ['text.chat'],
  features: ['tools', 'structured'],
  // 上下文窗口与最大输出：按量渠道见 https://docs.volcengine.com/docs/ark/model-list?lang=zh「deepseek-v4-flash-ga-260731」行，
  // 写「上下文窗口: 1024k」「最大回答(默认 4k): 384k」，2026-11-11 核对原文；套餐渠道见
  // https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview「支持模型及 Harness」表，
  // 写「上下文窗口：1024k」「最大输出：384k」，2026-11-07 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 384000,
  channels: [
    { channel: 'ark', id: 'deepseek-v4-flash-ga-260731' },
    {
      channel: 'ark-plan',
      id: 'deepseek-v4-flash',
      agentOnly: true,
      description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
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
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
