import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/wan3.0-video-prime',
  id: 'wan3.0-video-prime',
  title: 'wan3.0-video-prime',
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
    type: 'object',
    properties: {
      adaptive_duration: { type: 'boolean' },
      prompt_extend: { type: 'boolean' },
      watermark: { type: 'boolean' },
    },
  },
  channels: [{ channel: 'bailian', id: 'wan3.0-video-prime' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
