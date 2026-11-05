import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-image-2.5-sunburst',
  id: 'gpt-image-2.5-sunburst',
  title: 'gpt-image-2.5-sunburst',
  capabilities: ['image.generate', 'image.edit'],
  description: '支持多参考图与蒙版引导编辑；蒙版边界不保证像素级保留。',
  limits: {
    customSize: { min: 16, max: 3840, multiple: 16 },
    image: {
      size: {
        minPixels: 655360,
        maxPixels: 8294400,
        minRatio: 0.3333333333333333,
        maxRatio: 3,
        auto: true,
      },
    },
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
      size: {
        title: '输出尺寸',
        type: 'string',
        pattern: '^(auto|[1-9][0-9]*x[1-9][0-9]*)$',
        default: 'auto',
        'x-multiple': 16,
        'x-aspectRatioSizes': {
          '1:1': '1024x1024',
          '3:2': '1536x1024',
          '2:3': '1024x1536',
          '16:9': '1536x864',
          '9:16': '864x1536',
        },
      },
      output_compression: { title: '输出压缩', type: 'integer', minimum: 0, maximum: 100 },
      moderation: { title: '内容过滤', type: 'string', enum: ['auto', 'low'] },
      safety_identifier: { title: '安全标识', type: 'string', maxLength: 128 },
      markup: {
        title: '标记层',
        type: 'object',
        properties: { image_url: { type: 'string' }, file_id: { type: 'string' } },
      },
      background: { title: '背景', type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      output_format: {
        title: '输出格式',
        type: 'string',
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
      },
    },
  },
  default: true,
  channels: [{ channel: 'openai', id: 'gpt-image-2.5-sunburst' }],
  aliases: { official: ['gpt-image-2.5-sunburst-2026-09-08'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://developers.openai.com/api/docs/guides/image-generation',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://developers.openai.com/api/docs/guides/image-generation',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
