import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/kimi-k3.1-pro',
  id: 'kimi-k3.1-pro',
  title: 'kimi-k3.1-pro',
  capabilities: ['text.chat'],
  // 输入模态文本、图片，看图支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'vision', 'structured'],
  description: '百炼自营的 Kimi K3.1 Pro，文本与图片输入（不支持视频输入）；支持联网搜索',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/kimi-k3-1-pro
  // 「上下文限制」表：上下文长度 1048576、最大输入长度 1048576、最大输出长度 1048576，
  // 2026-11-14 核对原文。
  contextWindow: 1048576,
  maxInputTokens: 1048576,
  maxOutputTokens: 1048576,
  channels: [{ channel: 'bailian', id: 'kimi-k3.1-pro' }],
  // 月之暗面直供的同款模型：https://help.aliyun.com/zh/model-studio/kimi-k3-1-pro-by-moonshot
  // （2026-11-14 核对原文）。
  aliases: { official: ['kimi/kimi-k3.1-pro'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/kimi-k3-1-pro',
      checkedAt: '2026-11-14',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/kimi-k3-1-pro',
    checkedAt: '2026-11-14',
  },
} satisfies ModelDeclaration
