import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/glm-5.3',
  id: 'glm-5.3',
  title: 'glm-5.3',
  capabilities: ['text.chat'],
  // 输入模态只有 Text，看图不支持；Function Calling 与结构化输出都支持。
  features: ['tools', 'structured'],
  description: '百炼自营的智谱 GLM-5.3，纯文本输入；支持三档深度思考，不支持联网搜索',
  // 上下文与上下限：https://help.aliyun.com/zh/model-studio/glm-5-3
  // 「上下文限制」表：上下文长度 1048576、最大输入长度 1048576、最大输出长度 131072，
  // 2026-11-14 核对原文。
  contextWindow: 1048576,
  maxInputTokens: 1048576,
  maxOutputTokens: 131072,
  channels: [
    { channel: 'bailian', id: 'glm-5.3' },
    {
      channel: 'bailian-plan',
      id: 'glm-5.3',
      // Token Plan 套餐文本模型只给 AI 编程 / 智能体工具交互式使用
      agentOnly: true,
      source: {
        url: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview',
        checkedAt: '2026-11-14',
      },
    },
  ],
  // 智谱直供的同款模型，规格与百炼自营一致：
  // https://help.aliyun.com/zh/model-studio/glm-5-3-by-zhipu（2026-11-14 核对原文）。
  aliases: { official: ['ZHIPU/GLM-5.3'], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/glm-5-3', checkedAt: '2026-11-14' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/glm-5-3', checkedAt: '2026-11-14' },
} satisfies ModelDeclaration
