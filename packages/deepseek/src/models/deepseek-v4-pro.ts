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
        enum: ['none', 'low', 'high', 'max'],
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
} satisfies ModelDeclaration
