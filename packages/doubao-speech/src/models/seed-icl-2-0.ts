import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'doubao/seed-icl-2.0',
  id: 'seed-icl-2.0',
  title: '豆包声音复刻 2.0（已有音色）',
  capabilities: ['audio.speech'],
  limits: { speed: { min: 0.5, max: 2 }, promptMaxLength: 3000 },
  channels: [{ channel: 'doubao-speech', id: 'seed-icl-2.0' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
