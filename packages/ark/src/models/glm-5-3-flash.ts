import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/glm-5.3-flash',
  id: 'glm-5.3-flash',
  title: 'glm-5.3-flash',
  capabilities: ['text.chat'],
  features: ['tools', 'vision'],
  // 上下文窗口与最大输出：按量渠道见 https://docs.volcengine.com/docs/ark/model-list?lang=zh「glm-5-3-flash-260828」行，
  // 写「上下文窗口: 1024k」「最大回答(默认 4k): 128k」，2026-11-11 核对原文；套餐渠道见
  // https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview「支持模型及 Harness」表，
  // 写「上下文窗口：1024k」「最大输出：128k」，2026-11-07 核对原文。
  // 特性按「glm-5-3-flash-260828」行的能力列（多模态理解 / 工具调用 / 结构化输出）填写，2026-11-11 核对；套餐渠道保留原值。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 128000,
  channels: [
    { channel: 'ark', id: 'glm-5-3-flash-260828' },
    {
      channel: 'ark-plan',
      id: 'glm-5.3-flash',
      agentOnly: true,
      description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
      features: ['tools', 'structured', 'vision'],
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
