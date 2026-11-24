import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/step-5-preview',
  id: 'stepfun/step-5-preview',
  title: 'stepfun/step-5-preview',
  capabilities: ['text.chat'],
  // 输入模态 Text、Image、Video，看图支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'vision', 'structured'],
  description: '阶跃星辰 Step 5 Preview，文本与图片输入',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/step-5-preview
  // 「上下文限制」表：上下文长度 1048576、最大输入长度 1048576、最大输出长度 1048576，
  // 2026-11-24 核对原文。
  contextWindow: 1048576,
  maxInputTokens: 1048576,
  maxOutputTokens: 1048576,
  channels: [{ channel: 'bailian', id: 'stepfun/step-5-preview' }],
  // 模型目录只列带厂商前缀的 stepfun/step-5-preview（渠道 ID），没有不带前缀的写法，不设官方别名：
  // https://help.aliyun.com/zh/model-studio/model-list-text-generation，2026-11-24 核对原文。
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/step-5-preview',
      checkedAt: '2026-11-24',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/step-5-preview',
    checkedAt: '2026-11-24',
  },
} satisfies ModelDeclaration
