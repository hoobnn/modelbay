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
    type: 'object',
    properties: {
      prompt_optimizer: { type: 'boolean' },
      aigc_watermark: { type: 'boolean' },
      style_type: { type: 'string', enum: ['漫画', '元气', '中世纪', '水彩'] },
      style_weight: { type: 'number' },
    },
  },
  channels: [{ channel: 'minimax', id: 'image-01-live' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://platform.minimax.cn/docs/api-reference', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
