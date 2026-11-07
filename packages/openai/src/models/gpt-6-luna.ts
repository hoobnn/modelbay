import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-6-luna',
  id: 'gpt-6-luna',
  title: 'gpt-6-luna',
  capabilities: ['text.chat'],
  features: ['vision', 'tools', 'structured'],
  // 上下文窗口与最大输出：https://developers.openai.com/api/docs/models/gpt-6-luna
  // 页面写「1,050,000 context window」「128,000 max output tokens」，2026-11-07 核对原文。
  contextWindow: 1050000,
  maxOutputTokens: 128000,
  limits: { temperature: false },
  optionsSchema: {
    type: 'object',
    properties: {
      reasoning_effort: {
        title: '思考强度',
        type: 'string',
        enum: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      reasoning_mode: { title: '推理模式', type: 'string', enum: ['standard', 'pro'] },
      reasoning_summary: {
        title: '推理摘要',
        type: 'string',
        description: '摘要样式由所选模型决定，推荐 auto。',
      },
      reasoning_context: { title: '推理上下文', type: 'string', enum: ['auto', 'current_turn'] },
      verbosity: { title: '回答详略', type: 'string', enum: ['low', 'medium', 'high'] },
      service_tier: {
        title: '服务档位',
        type: 'string',
        enum: ['auto', 'default', 'flex', 'priority', 'fast'],
      },
      parallel_tool_calls: { title: '并行工具调用', type: 'boolean' },
      prompt_cache_key: { title: '缓存标识', type: 'string' },
      prompt_cache_options: {
        title: '缓存设置',
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['implicit', 'explicit'] },
          ttl: { type: 'string', enum: ['30m', '12h'] },
          prewarm: { type: 'boolean' },
        },
      },
      safety_identifier: { title: '安全标识', type: 'string', maxLength: 128 },
      store: { title: '保存响应', type: 'boolean', default: false },
      previous_response_id: { title: '前一响应 ID', type: 'string' },
      conversation: { title: '会话 ID', type: 'string' },
      truncation: { title: '上下文截断', type: 'string', enum: ['auto', 'disabled'] },
    },
  },
  channels: [{ channel: 'openai', id: 'gpt-6-luna' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    checkedAt: '2026-11-07',
  },
} satisfies ModelDeclaration
