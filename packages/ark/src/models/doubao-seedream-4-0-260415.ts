import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seedream-4-0-260415',
  id: 'doubao-seedream-4-0-260415',
  title: 'Seedream 4.0（支持组图）',
  capabilities: ['image.generate'],
  description:
    '文生图、单图 / 多参考图生图，支持组图生成；最多 14 张参考图，分辨率档位 1K / 2K / 4K',
  limits: {
    // 一次几张、最多几张参考图、有哪些分辨率档位都取自官方「图像生成 API」页
    // （2026-11-24 核对）：「Seedream 4.0 最多支持传入 14 张参考图」；
    // 「sequential_image_generation_options.max_images」取值范围 [1, 15]，
    // 「输入的参考图数量 + 最终生成的图片数量 ≤ 15 张」；
    // size 写「可选值：1K、2K、4K」「默认值：2048x2048」，
    // 「总像素取值范围：[1280x720（921600）, 4096x4096（16777216）]」「宽高比取值范围：[1/16, 16]」。
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '2K',
    references: { max: 14 },
    count: { max: 15 },
    seed: false,
    negativePrompt: false,
    image: {
      maxTotalImages: 15,
      size: {
        minPixels: 921600,
        maxPixels: 16777216,
        minRatio: 0.0625,
        maxRatio: 16,
        tiers: ['1K', '2K', '4K'],
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
    },
  },
  channels: [{ channel: 'ark', id: 'doubao-seedream-4-0-260415' }],
  // 模型列表页「doubao-seedream-4-0-260415（同时支持：doubao-seedream-4-0-20260415）」，
  // https://docs.volcengine.com/docs/ark/model-list?lang=zh，2026-11-24 核对原文。
  aliases: { official: ['doubao-seedream-4-0-20260415'], short: [] },
  lifecycle: {
    // 模型列表页「图片生成能力 › 推荐模型」仍列着，没有下线标记，2026-11-24 核对原文。
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-24',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh',
    checkedAt: '2026-11-24',
  },
} satisfies ModelDeclaration
