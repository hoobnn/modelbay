import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen3.8-max',
  id: 'qwen3.8-max',
  title: 'qwen3.8-max',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  // 上下文窗口与最大输出：https://help.aliyun.com/zh/model-studio/qwen3-8-max
  // 「上下文限制」表，上下文长度 1000000、最大输出长度 131072（思考模式下同为 131072），2026-11-07 核对原文。
  // 官方直接给出上下文长度，不用最大输入加最大输出换算。
  contextWindow: 1000000,
  maxOutputTokens: 131072,
  default: true,
  channels: [{ channel: 'bailian', id: 'qwen3.8-max' }],
  aliases: { official: [], short: ['max'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/text-generation-model',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/text-generation-model',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
