import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-6-luna',
  id: 'gpt-6-luna',
  title: 'gpt-6-luna',
  capabilities: ['text.chat'],
  features: ['vision', 'tools', 'structured'],
  limits: { temperature: false },
  optionsSchema: {
    type: 'object',
    properties: { reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high'] } },
  },
  channels: [{ channel: 'openai', id: 'gpt-6-luna' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
