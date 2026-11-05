import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-image-2.5-sunburst',
  id: 'gpt-image-2.5-sunburst',
  title: 'gpt-image-2.5-sunburst',
  capabilities: ['image.generate', 'image.edit'],
  description: '支持多参考图与蒙版引导编辑；蒙版边界不保证像素级保留。',
  limits: {
    promptMaxLength: 32000,
    aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
    count: { max: 10 },
    references: { max: 16 },
    seed: false,
  },
  optionsSchema: {
    type: 'object',
    properties: {
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] },
      background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
    },
  },
  default: true,
  channels: [{ channel: 'openai', id: 'gpt-image-2.5-sunburst' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
