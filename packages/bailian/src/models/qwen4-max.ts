import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen4-max',
  id: 'qwen4-max',
  title: 'qwen4-max',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  // https://help.aliyun.com/zh/model-studio/qwen4-max（2026-11-18 核对）：上下文长度 1,000,000；
  // 最大输出长度为 262,144（默认开启的思考模式），非思考模式下为 131,072。
  contextWindow: 1000000,
  maxOutputTokens: 262144,
  channels: [{ channel: 'bailian', id: 'qwen4-max' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/qwen4-max',
      checkedAt: '2026-11-18',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/qwen4-max',
    checkedAt: '2026-11-18',
  },
} satisfies ModelDeclaration
