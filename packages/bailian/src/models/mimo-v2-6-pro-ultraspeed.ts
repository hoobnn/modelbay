import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/mimo-v2.6-pro-ultraspeed',
  id: 'xiaomi/mimo-v2.6-pro-ultraspeed',
  title: 'xiaomi/mimo-v2.6-pro-ultraspeed',
  capabilities: ['text.chat'],
  // 输入模态 Text、Image、Video、Audio，看图支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'vision', 'structured'],
  description: '小米 MiMo-V2.6-Pro 的高速版，文本、图片、视频、音频输入；不支持联网搜索',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/mimo-v2-6-pro-ultraspeed
  // 「上下文限制」表：上下文长度 1048576、最大输入长度 1048576、最大输出长度 131072，
  // 2026-11-24 核对原文。
  contextWindow: 1048576,
  maxInputTokens: 1048576,
  maxOutputTokens: 131072,
  channels: [{ channel: 'bailian', id: 'xiaomi/mimo-v2.6-pro-ultraspeed' }],
  // 不带厂商前缀的写法指向同一个模型：
  // https://help.aliyun.com/zh/model-studio/models（模型广场条目），2026-11-24 核对原文。
  aliases: { official: ['mimo-v2.6-pro-ultraspeed'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/mimo-v2-6-pro-ultraspeed',
      checkedAt: '2026-11-24',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/mimo-v2-6-pro-ultraspeed',
    checkedAt: '2026-11-24',
  },
} satisfies ModelDeclaration
