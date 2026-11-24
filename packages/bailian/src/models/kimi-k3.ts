import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/kimi-k3',
  id: 'kimi-k3',
  title: 'kimi-k3',
  capabilities: ['text.chat'],
  // 输入模态 Text、Image，看图支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'vision', 'structured'],
  description: '百炼自营的 Kimi K3，文本与图片输入；支持前缀续写，不支持联网搜索',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/kimi-k3
  // 「上下文限制」表：上下文长度 1048576、最大输入长度 1048576、最大输出长度 1048576，
  // 2026-11-24 核对原文。
  contextWindow: 1048576,
  maxInputTokens: 1048576,
  maxOutputTokens: 1048576,
  channels: [{ channel: 'bailian', id: 'kimi-k3' }],
  // 月之暗面直供的同款模型，规格与百炼自营一致：
  // https://help.aliyun.com/zh/model-studio/kimi-k3-by-moonshot（2026-11-24 核对原文）。
  aliases: { official: ['kimi/kimi-k3'], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/kimi-k3', checkedAt: '2026-11-24' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/kimi-k3', checkedAt: '2026-11-24' },
} satisfies ModelDeclaration
