import type { ModelDeclaration } from '@modelbay/core'

/**
 * happyhorse-1.0-video-edit：百炼的 HappyHorse 视频指令编辑模型。
 *
 * 请求体与 video.generate 不同（input.media 只收 1 个 video 加 0–5 个 reference_image，
 * 没有 ratio / duration / audio），所以走 native `edit-video`，不经 generate_video。
 * 能力仍记为最接近的 video.generate，与 wan2.2-s2v 一致。
 *
 * 来源（2026-11-06 核对）：
 * - https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference
 * - https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference
 */
export default {
  canonicalId: 'aliyun/happyhorse-1.0-video-edit',
  id: 'happyhorse-1.0-video-edit',
  title: 'HappyHorse 1.0 视频编辑',
  description: '视频指令编辑：按提示词修改风格与元素，输入视频 3–60 秒，输出最多 15 秒。',
  capabilities: ['video.generate'],
  native: ['edit-video'],
  limits: {
    resolutions: ['720P', '1080P'],
    defaultResolution: '1080P',
    references: { max: 5 },
    media: {
      video: {
        mime: ['video/mp4', 'video/quicktime'],
        maxMB: 100,
        minDuration: 3,
        maxDuration: 60,
        minEdge: 360,
        maxEdge: 4096,
        minRatio: 0.4,
        maxRatio: 2.5,
        minFrameRate: 8,
        maxFrameRate: 60,
      },
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
      audio_setting: {
        title: '音频',
        description: 'auto 由模型决定（官方默认）；origin 保留输入视频的原声',
        type: 'string',
        enum: ['auto', 'origin'],
      },
      seed: {
        title: '随机种子',
        description: '0–2147483647；不传则随机。固定种子只提高可复现性，不保证输出完全一致',
        type: 'integer',
        minimum: 0,
        maximum: 2147483647,
      },
    },
  },
  channels: [{ channel: 'bailian', id: 'happyhorse-1.0-video-edit' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference',
      checkedAt: '2026-11-06',
    },
  },
  source: {
    url: 'https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference',
    checkedAt: '2026-11-06',
  },
} satisfies ModelDeclaration
