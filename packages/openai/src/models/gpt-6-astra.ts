import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-6-astra',
  id: 'gpt-6-astra',
  title: 'gpt-6-astra',
  capabilities: ['text.chat'],
  features: ['vision', 'tools', 'structured'],
  limits: { temperature: false },
  optionsSchema: {
    type: 'object',
    properties: {
      reasoning_effort: { title: '思考强度', type: 'string', enum: ['low', 'medium', 'high'] },
    },
  },
  channels: [{ channel: 'openai', id: 'gpt-6-astra' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
