import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seedream-5-0-260128',
  id: 'doubao-seedream-5-0-260128',
  title: 'Seedream 5.0 Lite（支持组图）',
  capabilities: ['image.generate'],
  description:
    '已停止新购，计划于 2026-11-24 14:00（UTC+8）下线；现有接入请提前迁移，Pro / Flash 不支持组图',
  limits: {
    // 一次几张、最多几张参考图、有哪些分辨率档位都取自官方「图像生成 API」页
    // （2026-11-05 核对）：lite 最多 14 张参考图、分辨率档位 2K/3K/4K、
    // 文生组图最多 15 张。
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    resolutions: ['2K', '3K', '4K'],
    defaultResolution: '2K',
    references: { max: 14 },
    count: { max: 15 },
    seed: false,
    negativePrompt: false,
    image: {
      maxTotalImages: 15,
      size: {
        minPixels: 3686400,
        maxPixels: 16777216,
        minRatio: 0.0625,
        maxRatio: 16,
        tiers: ['2K', '3K', '4K'],
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      watermark: {
        default: false,
        title: '水印',
        description: '在右下角加 AI 生成水印',
        type: 'boolean',
      },
      output_format: {
        title: '输出格式',
        labels: { jpeg: 'JPEG', png: 'PNG' },
        type: 'string',
        enum: ['jpeg', 'png'],
      },
    },
  },
  channels: [{ channel: 'ark', id: 'doubao-seedream-5-0-260128' }],
  aliases: { official: ['doubao-seedream-5-0-lite-260128'], short: [] },
  lifecycle: {
    status: 'sunsetting',
    sunsetOn: '2026-11-24',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh',
      checkedAt: '2026-11-04',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
