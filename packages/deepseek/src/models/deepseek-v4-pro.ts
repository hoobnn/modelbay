import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'deepseek/deepseek-v4-pro',
  id: 'deepseek-v4-pro',
  title: 'DeepSeek V4 Pro',
  version: 'DeepSeek-V4-Pro-0813',
  capabilities: ['text.chat'],
  features: ['tools', 'structured'],
  // https://api-docs.deepseek.com/api/list-models/ 示例 context_window=1048576、max_output_tokens=393216；2026-11-13 核对。
  contextWindow: 1048576,
  maxOutputTokens: 393216,
  channels: [
    {
      channel: 'deepseek',
      id: 'deepseek-v4-pro',
    },
  ],
  aliases: {
    official: [],
    short: [],
  },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://api-docs.deepseek.com/quick_start/pricing/',
      checkedAt: '2026-11-13',
    },
  },
  source: {
    url: 'https://api-docs.deepseek.com/api/list-models/',
    checkedAt: '2026-11-13',
  },
  // 参数协议：https://api-docs.deepseek.com/api/create-chat-completion/ 与 /api/create-response/；2026-11-13 核对。
  optionsSchema: {
    type: 'object',
    properties: {
      api: {
        type: 'string',
        title: '对话协议',
        enum: ['chat', 'responses'],
      },
      thinking: {
        type: 'object',
        title: '思考模式',
        properties: {
          type: {
            type: 'string',
            enum: ['enabled', 'disabled'],
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
      reasoning_effort: {
        type: 'string',
        title: '思考强度',
        // 官方「思考模式」页（https://api-docs.deepseek.com/guides/thinking_mode，2026-11-24 核对原文）
        // 的请求强度映射表列出 minimal / low / medium / high / xhigh / max / ultra 七种请求值：
        // minimal→low、low→low、medium→high、high→high、xhigh→high、max→max、ultra→max。
        // none 只在 Responses API 生效（关闭思考模式），Chat Completions 用 thinking.type 关闭。
        enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      },
      top_p: {
        type: 'number',
        title: 'Top P',
        minimum: 0,
        maximum: 1,
      },
      stop: {
        type: ['string', 'array'],
        title: '停止词',
        anyOf: [
          {
            type: 'string',
          },
          {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        ],
      },
      user: {
        type: 'string',
        title: '用户标识',
      },
      logprobs: {
        type: 'boolean',
        title: '返回 token 概率',
      },
      top_logprobs: {
        type: 'integer',
        title: '候选 token 数',
        minimum: 0,
        maximum: 20,
      },
    },
    additionalProperties: false,
  },
  // 官方「思考模式」页写「Thinking mode does not support the temperature, presence_penalty,
  // or frequency_penalty parameters」，思考模式是默认开的，设了也不报错但没有效果，
  // https://api-docs.deepseek.com/guides/thinking_mode（2026-11-24 核对原文）。
  // 关闭思考时温度才生效：本项目不替用户切换思考模式，默认（思考开启）按「不支持调温」处理，不发 temperature；
  // 调用方显式关闭思考（thinking.type 为 disabled，或 Responses API 的 reasoning effort 为 none）时照常透传。
  limits: { temperature: false },
} satisfies ModelDeclaration
