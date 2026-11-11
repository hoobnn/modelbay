import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen3.7-plus',
  id: 'qwen3.7-plus',
  title: 'qwen3.7-plus',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  // 上下文窗口与最大输出：https://help.aliyun.com/zh/model-studio/qwen3-7-plus
  // 「上下文限制」表，上下文长度 1000000、最大输出长度 131072（思考模式下同为 131072），2026-11-07 核对原文。
  // 官方直接给出上下文长度，不用最大输入加最大输出换算。
  contextWindow: 1000000,
  maxOutputTokens: 131072,
  channels: [
    { channel: 'bailian', id: 'qwen3.7-plus' },
    {
      channel: 'bailian-plan',
      id: 'qwen3.7-plus',
      // Token Plan 套餐文本模型只给 AI 编程 / 智能体工具交互式使用
      agentOnly: true,
      source: {
        url: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview',
        checkedAt: '2026-11-11',
      },
    },
  ],
  aliases: { official: [], short: ['plus'] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
