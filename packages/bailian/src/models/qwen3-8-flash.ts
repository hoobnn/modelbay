import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen3.8-flash',
  id: 'qwen3.8-flash',
  title: 'qwen3.8-flash',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  channels: [{ channel: 'bailian', id: 'qwen3.8-flash' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
