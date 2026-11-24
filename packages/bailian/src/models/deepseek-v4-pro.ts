import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/deepseek-v4-pro',
  id: 'deepseek-v4-pro',
  title: 'deepseek-v4-pro',
  capabilities: ['text.chat'],
  // 输入模态只有 Text，看图不支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'structured'],
  description:
    '百炼自营的 DeepSeek V4 Pro，纯文本输入；支持联网搜索（enable_search），不支持前缀续写',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/deepseek-v4-pro
  // 「上下文限制」表：上下文长度 1000000、最大输入长度 1000000、最大输出长度 393216，
  // 2026-11-24 核对原文。
  contextWindow: 1000000,
  maxInputTokens: 1000000,
  maxOutputTokens: 393216,
  channels: [
    { channel: 'bailian', id: 'deepseek-v4-pro' },
    {
      channel: 'bailian-plan',
      id: 'deepseek-v4-pro',
      // Token Plan 套餐文本模型只给 AI 编程 / 智能体工具交互式使用
      agentOnly: true,
      source: {
        url: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview',
        checkedAt: '2026-11-24',
      },
    },
  ],
  // 快照 ID 与主 ID 是同一个模型：https://help.aliyun.com/zh/model-studio/newly-released-models
  // 「deepseek-v4-pro-0813」条目，2026-11-24 核对原文。
  aliases: { official: ['deepseek-v4-pro-0813'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/deepseek-v4-pro',
      checkedAt: '2026-11-24',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/deepseek-v4-pro',
    checkedAt: '2026-11-24',
  },
} satisfies ModelDeclaration
