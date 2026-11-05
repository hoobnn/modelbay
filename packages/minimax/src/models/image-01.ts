import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/image-01',
  id: 'image-01',
  title: 'image-01',
  capabilities: ['image.generate'],
  limits: {
    aspectRatios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K'],
    image: { resolutionsByAspectRatio: { '21:9': ['2K'] } },
    count: { max: 9 },
    references: { max: 1 },
    customSize: { min: 512, max: 2048, multiple: 8 },
    negativePrompt: false,
    promptMaxLength: 1500,
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      prompt_optimizer: { title: '提示词优化', type: 'boolean' },
      aigc_watermark: { title: '水印', type: 'boolean' },
    },
  },
  default: true,
  channels: [{ channel: 'minimax', id: 'image-01' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
