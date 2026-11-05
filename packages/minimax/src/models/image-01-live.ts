import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/image-01-live',
  id: 'image-01-live',
  title: 'image-01-live',
  capabilities: ['image.generate'],
  description: '中国区官方支持的画风模型；国际区官方文档未列出，未做国际区云端验收',
  limits: {
    aspectRatios: ['16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    count: { max: 9 },
    references: { max: 1 },
    customSize: false,
    negativePrompt: false,
    promptMaxLength: 1500,
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      prompt_optimizer: { title: '提示词优化', type: 'boolean' },
      aigc_watermark: { title: '水印', type: 'boolean' },
      style_type: { title: '画风', type: 'string', enum: ['漫画', '元气', '中世纪', '水彩'] },
      style_weight: {
        title: '画风权重',
        description: '大于 0 且不超过 1，默认 0.8；选择画风后生效',
        type: 'number',
        exclusiveMinimum: 0,
        maximum: 1,
      },
    },
  },
  channels: [{ channel: 'minimax', id: 'image-01-live' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
