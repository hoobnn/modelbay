import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'doubao/bigmodel',
  id: 'bigmodel',
  title: '录音文件识别极速版',
  capabilities: ['audio.transcribe'],
  limits: {
    media: {
      audio: {
        mime: [
          'audio/mpeg',
          'audio/mp3',
          'audio/wav',
          'audio/x-wav',
          'audio/ogg',
          'audio/flac',
          'audio/mp4',
        ],
        maxMB: 100,
        minBytes: 1,
      },
    },
  },
  channels: [{ channel: 'doubao-speech', id: 'bigmodel' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://docs.volcengine.com/docs/6561/1354869', checkedAt: '2026-11-05' },
  },
  source: { url: 'https://docs.volcengine.com/docs/6561/1354869', checkedAt: '2026-11-05' },
} satisfies ModelDeclaration
