import type { ModelDeclaration } from '@modelbay/core'

// 只能走 Token Plan（套餐专用 Key 与 Base URL），不支持按量计费；套餐条款限定在 AI 编程 / 智能体工具里交互式使用，
// 所以标 agentOnly，由宿主决定是否开放（同方舟 ark-plan 文本模型）。
// 2026-11-11 核对：https://help.aliyun.com/zh/model-studio/qwen4-max-preview
export default {
  canonicalId: 'aliyun/qwen4-max-preview',
  id: 'qwen4-max-preview',
  title: 'qwen4-max-preview',
  capabilities: ['text.chat'],
  // max_tokens 与 max_completion_tokens 等价，同时限制思考与回答；多轮对话须在 reasoning_content 回传思考内容
  description:
    'Token Plan 套餐预览模型，仅用于内置 Agent；max_tokens 同时限制思考与回答，预览期结束后下线',
  features: ['tools', 'vision', 'structured'],
  agentOnly: true,
  // 上下文窗口与最大输出：https://help.aliyun.com/zh/model-studio/qwen4-max-preview
  // 「模型能力与规格」表，上下文长度「1M Token」、最大输出长度「393,216 Token，思考与最终回答共享此预算」，2026-11-11 核对原文。
  contextWindow: 1000000,
  maxOutputTokens: 393216,
  channels: [
    {
      channel: 'bailian-plan',
      id: 'qwen4-max-preview',
      source: {
        url: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview',
        checkedAt: '2026-11-11',
      },
    },
  ],
  // 「qwen4-max-preview 的别名为 qwen4.0-max-preview，两个 ID 均可调用」：Token Plan 个人版概览，2026-11-11 核对
  aliases: { official: ['qwen4.0-max-preview'], short: [] },
  lifecycle: {
    // 「预览期为 2026 年 11 月 11 日 10:00 至 11 月 25 日 24:00（UTC+8），期间不做变更，预览结束后下线」
    status: 'sunsetting',
    sunsetOn: '2026-11-25',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/qwen4-max-preview',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/qwen4-max-preview',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
