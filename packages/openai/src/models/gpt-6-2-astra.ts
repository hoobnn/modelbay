import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-6.2-astra',
  id: 'gpt-6.2-astra',
  title: 'gpt-6.2-astra',
  capabilities: ['text.chat'],
  features: ['vision', 'tools', 'structured'],
  // 上下文窗口与最大输出：https://developers.openai.com/api/docs/models/gpt-6.2-astra
  // 页面写「1,050,000 context window」「128,000 max output tokens」（另写「Maximum input tokens: 922,000」），2026-11-19 核对原文。
  contextWindow: 1050000,
  maxOutputTokens: 128000,
  // 不支持 temperature：https://developers.openai.com/api/docs/guides/latest-model/gpt-6.2-astra 「omit `temperature`」，2026-11-19 核对。
  limits: { temperature: false },
  optionsSchema: {
    type: 'object',
    properties: {
      // 官方只写明「rejects requests that set reasoning effort to `none`」，未列出可选值（2026-11-19），不写 enum。
      reasoning_effort: {
        title: '思考强度',
        type: 'string',
        description: '不支持 none；官方建议从 medium 开始。',
      },
      reasoning_summary: {
        title: '推理摘要',
        type: 'string',
        description: '摘要样式由所选模型决定，推荐 auto。',
      },
      // 推理指南只列 GPT-5.6 与 GPT-6.1 Sol 支持 all_turns（2026-11-19），这里不写。
      reasoning_context: { title: '推理上下文', type: 'string', enum: ['auto', 'current_turn'] },
      verbosity: { title: '回答详略', type: 'string', enum: ['low', 'medium', 'high'] },
      // 迁移指南：「don't support Flex processing (`service_tier: flex`)」，支持 Standard / Fast / Batch / Ultrafast，2026-11-19 核对。
      service_tier: {
        title: '服务档位',
        type: 'string',
        enum: ['auto', 'default', 'priority', 'fast', 'ultrafast'],
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
  // 默认选型依据（2026-11-19）：https://developers.openai.com/api/docs/guides/reasoning
  // 原文「Start with gpt-6.2-astra for most reasoning workloads.」
  default: true,
  channels: [{ channel: 'openai', id: 'gpt-6.2-astra' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://developers.openai.com/api/docs/models/gpt-6.2-astra',
      checkedAt: '2026-11-19',
    },
  },
  source: {
    url: 'https://developers.openai.com/api/docs/models/gpt-6.2-astra',
    checkedAt: '2026-11-19',
  },
} satisfies ModelDeclaration
