import type { ModelDeclaration } from '@modelbay/core'

/**
 * z-image-turbo：百炼最快的文生图型号，只支持文生图、每次 1 张。
 *
 * 来源：https://help.aliyun.com/zh/model-studio/image-model（2026-11-05 核对）
 */
export default {
  canonicalId: 'aliyun/z-image-turbo',
  id: 'z-image-turbo',
  title: 'z-image-turbo',
  description: '最快的文生图型号：写实人像与产品图好，只支持文生图，每次 1 张。',
  capabilities: ['image.generate'],
  channels: [{ channel: 'bailian', id: 'z-image-turbo' }],
  aliases: { official: [], short: ['z'] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/image-model', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/image-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
