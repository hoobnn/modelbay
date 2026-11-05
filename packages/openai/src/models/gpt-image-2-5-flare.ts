import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-image-2.5-flare',
  id: 'gpt-image-2.5-flare',
  title: 'gpt-image-2.5-flare',
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
      quality: {
        title: '画质',
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      background: { title: '背景', type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      output_format: { title: '输出格式', type: 'string', enum: ['png', 'jpeg', 'webp'] },
    },
  },
  channels: [{ channel: 'openai', id: 'gpt-image-2.5-flare' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
