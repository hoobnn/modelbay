import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen3.8-max',
  id: 'qwen3.8-max',
  title: 'qwen3.8-max',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  default: true,
  channels: [{ channel: 'bailian', id: 'qwen3.8-max' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
