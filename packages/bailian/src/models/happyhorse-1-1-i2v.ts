import type { ModelDeclaration } from '@modelbay/core'

// 参数与上下限：https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference
// 接口与万相 3.0 相同（video-synthesis 异步任务）。resolution「480P / 720P / 1080P」，「1080P：默认值」；
// duration「取值范围：`3~15`之间的整数」「默认值：`5`」；seed「[0, 2147483647]」；watermark「true：默认值」。
// 页面没有 audio、negative_prompt、prompt_extend 参数。prompt「长度不超过5000个非中文字符或2500个中文字符」。
// media 「有且仅有1张首帧图像」，prompt 可选；没有 ratio 参数，「输出的视频宽高比与输入首帧近似一致」。
// 首帧：JPEG/JPG/PNG/WEBP，宽和高不小于 300 像素，宽高比 1:2.5～2.5:1，不超过 20MB。
// 以上 2026-11-11 核对原文。
export default {
  canonicalId: 'aliyun/happyhorse-1.1-i2v',
  id: 'happyhorse-1.1-i2v',
  title: 'HappyHorse 1.1 图生视频',
  description: '首帧生视频：1 张首帧，提示词可选，宽高比跟随首帧，3–15 秒。',
  capabilities: ['video.generate'],
  limits: {
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '1080P',
    duration: { min: 3, max: 15 },
    seed: { min: 0, max: 2147483647 },
    negativePrompt: false,
    audio: false,
    videoModes: ['image'],
    optionalVideoPrompt: true,
    media: {
      image: {
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        maxMB: 20,
        minEdge: 300,
        minRatio: 0.4,
        maxRatio: 2.5,
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
  channels: [{ channel: 'bailian', id: 'happyhorse-1.1-i2v' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/video-generation',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
