import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seedream-5-5-261028',
  id: 'doubao-seedream-5-5-261028',
  title: 'Seedream 5.5',
  capabilities: ['image.generate', 'image.process'],
  limits: {
    // 一次几张、最多几张参考图、有哪些分辨率档位都取自官方「图像生成 API」页
    // （2026-11-13 核对）：Seedream 5.5 最多 10 张参考图、分辨率档位 1K/1.5K/2K、只生成单图。
    imageOperations: ['cutout'],
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '1.5K', '2K'],
    defaultResolution: '2K',
    count: { max: 1 },
    references: { max: 10 },
    seed: false,
    negativePrompt: false,
    image: {
      size: {
        minPixels: 921600,
        maxPixels: 4624220,
        minRatio: 0.0625,
        maxRatio: 16,
        tiers: ['1K', '1.5K', '2K'],
      },
    },
    media: {
      process: {
        mime: ['image/png', 'image/jpeg'],
        maxMB: 30,
        minRatio: 0.0625,
        maxRatio: 16,
        minPixels: 262144,
        maxPixels: 36000000,
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
        default: 'png',
        title: '输出格式',
        labels: { jpeg: 'JPEG', png: 'PNG' },
        type: 'string',
        enum: ['jpeg', 'png'],
      },
      background: {
        title: '透明通道模式',
        type: 'string',
        enum: ['auto', 'transparent', 'opaque'],
        default: 'auto',
      },
      layer_decomposition_options: {
        title: '图层拆分配置',
        description: '仅用于 image.process 的 cutout 操作，图片生成不接受此配置',
        type: 'object',
        properties: {
          max_images: { type: 'integer', minimum: 2, maximum: 100, default: 30 },
          text_recognition: { type: 'boolean', default: false },
        },
        additionalProperties: false,
      },
    },
  },
  channels: [{ channel: 'ark', id: 'doubao-seedream-5-5-261028' }],
  aliases: { official: [], short: ['seedream-5.5'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-13',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh',
    checkedAt: '2026-11-13',
  },
} satisfies ModelDeclaration
