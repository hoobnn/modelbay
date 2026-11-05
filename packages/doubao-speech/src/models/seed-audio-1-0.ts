import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'doubao/seed-audio-1.0',
  id: 'seed-audio-1.0',
  title: 'Seed Audio 1.0',
  capabilities: ['audio.music', 'audio.sfx'],
  limits: { duration: { min: 1, max: 120 }, promptMaxLength: 2971 },
  default: true,
  channels: [{ channel: 'doubao-speech', id: 'seed-audio-1.0' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://docs.volcengine.com/docs/6561/2499930', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://docs.volcengine.com/docs/6561/2499930', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
