import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/wan3.0-video',
  id: 'wan3.0-video',
  title: 'wan3.0-video',
  capabilities: ['video.generate'],
  limits: {
    aspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '720P',
    duration: { min: 2, max: 30 },
    references: { max: 10 },
    referenceMedia: { video: 5, audio: 5 },
    videoModes: ['text', 'image', 'frames', 'reference'],
    media: {
      image: {
        mime: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff'],
        maxMB: 20,
      },
      video: {
        mime: ['video/mp4', 'video/quicktime'],
        maxMB: 100,
        minDuration: 0,
        totalDurationMax: 15,
        totalWithOutputMax: 30,
        outputDurationDefault: 5,
      },
      audio: {
        mime: ['audio/wav', 'audio/x-wav', 'audio/mpeg'],
        maxMB: 15,
        minDuration: 0,
        totalDurationMax: 15,
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      adaptive_duration: {
        title: '自动时长',
        description: '由模型在有效范围内选择时长',
        type: 'boolean',
      },
      prompt_extend: {
        title: '提示词扩写',
        description: '由模型自动润色、补充提示词',
        type: 'boolean',
      },
      watermark: { title: '水印', type: 'boolean' },
    },
  },
  default: true,
  channels: [{ channel: 'bailian', id: 'wan3.0-video' }],
  aliases: { official: [], short: ['wan'] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/video-generation',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/video-generation',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
