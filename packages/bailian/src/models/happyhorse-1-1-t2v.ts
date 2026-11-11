import type { ModelDeclaration } from '@modelbay/core'

// 参数与上下限：https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference
// 接口与万相 3.0 相同（video-synthesis 异步任务）。resolution「480P / 720P / 1080P」，「1080P：默认值」；
// duration「取值范围：`3~15`之间的整数」「默认值：`5`」；seed「[0, 2147483647]」；watermark「true：默认值」。
// 页面没有 audio、negative_prompt、prompt_extend 参数。prompt「长度不超过5000个非中文字符或2500个中文字符」。
// 只收提示词，没有 media；ratio 可选 9 种，默认 16:9。
// 以上 2026-11-11 核对原文。
export default {
  canonicalId: 'aliyun/happyhorse-1.1-t2v',
  id: 'happyhorse-1.1-t2v',
  title: 'HappyHorse 1.1 文生视频',
  description: '文生视频：3–15 秒，480P / 720P / 1080P，9 种画幅，输出带音频。',
  capabilities: ['video.generate'],
  limits: {
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '1080P',
    duration: { min: 3, max: 15 },
    seed: { min: 0, max: 2147483647 },
    negativePrompt: false,
    audio: false,
    aspectRatios: ['21:9', '16:9', '5:4', '4:3', '1:1', '3:4', '4:5', '9:16', '9:21'],
    videoModes: ['text'],
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
  channels: [{ channel: 'bailian', id: 'happyhorse-1.1-t2v' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/video-generation',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
