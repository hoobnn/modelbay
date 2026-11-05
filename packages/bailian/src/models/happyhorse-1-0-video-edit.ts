import type { ModelDeclaration } from '@modelbay/core'

/**
 * happyhorse-1.0-video-edit：百炼的 HappyHorse 视频指令编辑模型。
 *
 * 来源：https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/happyhorse-1.0-video-edit',
  id: 'happyhorse-1.0-video-edit',
  title: 'HappyHorse 1.0 视频编辑',
  description: '视频指令编辑：按提示词修改风格与元素，输入视频 3–60 秒，输出最多 15 秒。',
  capabilities: ['video.generate'],
  channels: [{ channel: 'bailian', id: 'happyhorse-1.0-video-edit' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
