import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/qwen3-tts-instruct-flash',
  id: 'qwen3-tts-instruct-flash',
  title: 'qwen3-tts-instruct-flash',
  capabilities: ['audio.speech'],
  description: '已于 2026-10-10 下线；仅保留旧画布引用，请改用 qwen3-tts-flash 或豆包语音',
  limits: { speed: false, promptMaxLength: 600 },
  channels: [{ channel: 'bailian', id: 'qwen3-tts-instruct-flash' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
