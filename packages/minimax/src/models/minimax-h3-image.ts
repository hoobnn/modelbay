import type { ModelDeclaration } from '@modelbay/core'

// 参数与限制：文生图 POST /v1/images/generations、图片编辑 POST /v1/images/edits，两个模型相同
// （2026-11-11 核对：https://platform.minimax.cn/docs/api-reference/image-generation-h3-generations、
// https://platform.minimax.cn/docs/api-reference/image-generation-h3-edits）
export default {
  canonicalId: 'minimax/MiniMax-H3-Image',
  id: 'MiniMax-H3-Image',
  title: 'MiniMax-H3-Image',
  capabilities: ['image.generate'],
  description:
    '文生图与图片编辑（1–16 张参考图），按宽高比 + 面积档或直接按宽高出图，最大 2000 万像素',
  limits: {
    promptMaxLength: 32000,
    // 官方接受任意 X:Y（1:3–3:1），这里列常用画幅；其他比例用「自定义尺寸」
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '3:1', '1:3'],
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '4K',
    count: { max: 10 },
    references: { max: 16 },
    seed: false,
    negativePrompt: false,
    image: {
      size: { minPixels: 655360, maxPixels: 20000000, minRatio: 1 / 3, maxRatio: 3, auto: true },
    },
    media: {
      // 单张 ≤64 MB 是官方的单文件上限；另有请求体合计 ≤64 MiB（base64 后约为原文件的 4/3），
      // 由提交时的编码后总量检查兜住，超过时官方建议改用公网 URL 或 mm_file://
      image: {
        mime: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
        maxMB: 64,
        minEdge: 128,
        maxEdge: 8192,
        minRatio: 0.25,
        maxRatio: 4,
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      size: {
        title: '自定义尺寸',
        placeholder: '如 2720x1536 或 auto',
        description: '宽x高，面积 655360–20000000 像素、宽高比 1:3–3:1；填写后忽略画幅和分辨率',
        type: 'string',
      },
      output_format: {
        title: '输出格式',
        type: 'string',
        enum: ['jpeg', 'png', 'webp'],
        default: 'jpeg',
      },
      output_compression: {
        title: '压缩质量',
        description: '0–100，默认 95；只对 jpeg / webp 生效',
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      disable_prompt_enhanced: {
        title: '关闭提示词增强',
        description: '仅文生图；关闭后须指定画幅（非 auto）或自定义尺寸',
        type: 'boolean',
      },
      aigc_watermark: { title: '水印', type: 'boolean' },
    },
  },
  channels: [{ channel: 'minimax', id: 'MiniMax-H3-Image' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-11' },
  },
  source: { url: 'https://platform.minimax.cn/docs/faq/models', checkedAt: '2026-11-11' },
} satisfies ModelDeclaration
