import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seedream-5-0-pro-260628',
  id: 'doubao-seedream-5-0-pro-260628',
  title: 'Seedream 5.0 Pro',
  capabilities: ['image.generate', 'image.process'],
  limits: {
    // 一次几张、最多几张参考图、有哪些分辨率档位都取自官方「图像生成 API」页
    // （2026-11-05 核对）：pro 最多 10 张参考图、分辨率档位 1K/1.5K/2K、只生成单图。
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
    type: 'object',
    properties: {
      watermark: { type: 'boolean', default: false },
      output_format: { type: 'string', enum: ['jpeg', 'png'] },
    },
  },
  default: true,
  channels: [
    { channel: 'ark', id: 'doubao-seedream-5-0-pro-260628' },
    {
      channel: 'ark-plan',
      // 套餐概览页的表格写的是短横线的 doubao-seedream-5-0-pro，与接口不一致；
      // 套餐模型目录接口实际返回、也实际接受的是点号的 doubao-seedream-5.0-pro，
      // 以接口为准。
      id: 'doubao-seedream-5.0-pro',
      source: {
        url: 'https://docs.volcengine.com/docs/ark/list-ark-agent-plan-model-api?lang=zh',
        checkedAt: '2026-11-05',
      },
    },
  ],
  aliases: { official: [], short: ['seedream-pro'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
