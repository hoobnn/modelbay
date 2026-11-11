import type { ModelDeclaration } from '@modelbay/core'

// 参数与上下限：https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
// 「model」写「可选值：`wan2.7-image-pro`、`wan2.7-image`」，wan2.7-image 的 size 写「支持1K、2K（默认）两种规格，
// 不支持4K」「所有场景下，总像素在 [768*768, 2048*2048] 之间，宽高比范围为 [1:8, 8:1]」，其余参数与 pro 相同；
// 该页没有 negative_prompt / prompt_extend。2026-11-11 核对原文。
export default {
  canonicalId: 'aliyun/wan2.7-image',
  id: 'wan2.7-image',
  title: 'wan2.7-image',
  capabilities: ['image.generate'],
  description: '万相 2.7 图片生成与编辑，比 pro 快，最高 2K',
  limits: {
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K'],
    count: { max: 4 },
    references: { max: 9 },
    seed: { min: 0, max: 2147483647 },
    promptMaxLength: 5000,
    image: {
      referenceResolutions: ['1K', '2K'],
      sequential: { option: 'enable_sequential', maxCount: 12, resolutions: ['1K', '2K'] },
      size: {
        minPixels: 589824,
        maxPixels: 4194304,
        maxPixelsWithReferences: 4194304,
        maxPixelsSequential: 4194304,
        minRatio: 0.125,
        maxRatio: 8,
        tiers: ['1K', '2K'],
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      thinking_mode: { title: '思考模式', type: 'boolean' },
      enable_sequential: {
        title: '组图模式',
        description: '最多 12 张、最高 2K；张数为最大数量，实际张数由模型决定',
        type: 'boolean',
      },
      size: {
        title: '自定义尺寸',
        placeholder: '如 2048*1152',
        description: '留空用画幅 / 分辨率；填写后优先于画幅和分辨率',
        type: 'string',
      },
      watermark: { title: '水印', type: 'boolean' },
    },
  },
  channels: [{ channel: 'bailian', id: 'wan2.7-image' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
