import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/deepseek-v4.1-flash',
  id: 'deepseek-v4.1-flash',
  title: 'deepseek-v4.1-flash',
  capabilities: ['text.chat'],
  // 输入模态 Text、Image，看图支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'vision', 'structured'],
  description: '百炼自营的 DeepSeek V4.1 Flash，文本与图片输入；支持联网搜索（enable_search）',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/deepseek-v4-1-flash
  // 「上下文限制」表：上下文长度 1000000、最大输入长度 1000000、最大输出长度 393216，
  // 2026-11-14 核对原文。
  contextWindow: 1000000,
  maxInputTokens: 1000000,
  maxOutputTokens: 393216,
  channels: [
    { channel: 'bailian', id: 'deepseek-v4.1-flash' },
    {
      channel: 'bailian-plan',
      id: 'deepseek-v4.1-flash',
      // Token Plan 套餐文本模型只给 AI 编程 / 智能体工具交互式使用
      agentOnly: true,
      source: {
        url: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview',
        checkedAt: '2026-11-14',
      },
    },
  ],
  // 快照 ID 与主 ID 是同一个模型：https://help.aliyun.com/zh/model-studio/newly-released-models
  // 「deepseek-v4.1-flash-1017」条目，2026-11-14 核对原文。
  aliases: { official: ['deepseek-v4.1-flash-1017'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/deepseek-v4-1-flash',
      checkedAt: '2026-11-14',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/deepseek-v4-1-flash',
    checkedAt: '2026-11-14',
  },
} satisfies ModelDeclaration
