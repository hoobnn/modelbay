import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-6.1-terra',
  id: 'gpt-6.1-terra',
  title: 'gpt-6.1-terra',
  capabilities: ['text.chat'],
  features: ['vision', 'tools', 'structured'],
  limits: { temperature: false },
  optionsSchema: {
    type: 'object',
    properties: {
      reasoning_effort: { title: '思考强度', type: 'string', enum: ['low', 'medium', 'high'] },
    },
  },
  channels: [{ channel: 'openai', id: 'gpt-6.1-terra' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
