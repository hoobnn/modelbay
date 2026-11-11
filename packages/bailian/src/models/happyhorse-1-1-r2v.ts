import type { ModelDeclaration } from '@modelbay/core'

// 参数与上下限：https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference
// 接口与万相 3.0 相同（video-synthesis 异步任务）。resolution「480P / 720P / 1080P」，「1080P：默认值」；
// duration「取值范围：`3~15`之间的整数」「默认值：`5`」；seed「[0, 2147483647]」；watermark「true：默认值」。
// 页面没有 audio、negative_prompt、prompt_extend 参数。prompt「长度不超过5000个非中文字符或2500个中文字符」。
// media 只收 reference_image，「参考图像数量：1～9张」，prompt 里用「[Image 1]、[Image 2]」按 media 顺序引用。
// 参考图：JPEG/JPG/PNG/WEBP，短边不低于 400 像素，不超过 20MB。
// 以上 2026-11-11 核对原文。
export default {
  canonicalId: 'aliyun/happyhorse-1.1-r2v',
  id: 'happyhorse-1.1-r2v',
  title: 'HappyHorse 1.1 参考生视频',
  description:
    '参考图生视频：1–9 张参考图，提示词里用 @image1 引用（发送时换成 [Image 1]），3–15 秒。',
  capabilities: ['video.generate'],
  limits: {
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '1080P',
    duration: { min: 3, max: 15 },
    seed: { min: 0, max: 2147483647 },
    negativePrompt: false,
    audio: false,
    aspectRatios: ['21:9', '16:9', '5:4', '4:3', '1:1', '3:4', '4:5', '9:16', '9:21'],
    references: { max: 9 },
    videoModes: ['reference'],
    media: {
      image: {
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        maxMB: 20,
        minEdge: 400,
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      watermark: {
        title: '水印',
        description: '官方默认 true，在右下角加固定文字 Happy Horse；false 去掉',
        type: 'boolean',
      },
    },
  },
  channels: [{ channel: 'bailian', id: 'happyhorse-1.1-r2v' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/video-generation',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
