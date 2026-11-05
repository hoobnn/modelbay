import type { ModelDeclaration } from '@modelbay/core'

/**
 * wan2.2-s2v：万相 2.2 数字人对口型（图片 + 人声驱动口型与动作）。
 *
 * 数字人在 0003 里没有对应的归一化能力，按规定走 native（digital-human-lipsync）；
 * 声明里照样要有这个模型，能力取最接近的 video.generate。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/wan2-2-s2v（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/wan2.2-s2v',
  id: 'wan2.2-s2v',
  title: 'Wan 2.2 数字人对口型',
  description: '数字人对口型：图片 + 人声驱动人物口型、表情与动作。',
  capabilities: ['video.generate'],
  native: ['digital-human-lipsync'],
  channels: [{ channel: 'bailian', id: 'wan2.2-s2v' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/wan2-2-s2v', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/wan2-2-s2v', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
