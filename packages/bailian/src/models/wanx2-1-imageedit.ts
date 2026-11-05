import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/wanx2.1-imageedit',
  id: 'wanx2.1-imageedit',
  title: '万相图像编辑（局部重绘）',
  capabilities: ['image.edit', 'image.process'],
  description: 'Legacy，仅华北2（北京）地域；按蒙版只重绘白色区域，原生蒙版能力',
  limits: {
    count: { max: 1 },
    promptMaxLength: 800,
    imageOperations: ['upscale', 'outpaint'],
    process: { scale: { min: 1, max: 4 }, expansion: { min: 1, max: 2 } },
    media: {
      process: {
        mime: ['image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/webp'],
        maxMB: 10,
        minEdge: 512,
        maxEdge: 4096,
      },
    },
  },
  default: true,
  channels: [{ channel: 'bailian', id: 'wanx2.1-imageedit' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/image-model', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/image-model', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
