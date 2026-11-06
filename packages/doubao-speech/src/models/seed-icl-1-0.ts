import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'doubao/seed-icl-1.0',
  id: 'seed-icl-1.0',
  title: '豆包声音复刻 1.0（已有音色）',
  capabilities: ['audio.speech'],
  description: '历史 V3 接口兼容项；新接入请使用声音复刻 2.0',
  // 采样率：https://docs.volcengine.com/docs/6561/1598757 req_params.audio_params.sample_rate（2026-11-06 核对）
  limits: {
    speed: { min: 0.5, max: 2 },
    promptMaxLength: 3000,
    sampleRates: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
  },
  channels: [{ channel: 'doubao-speech', id: 'seed-icl-1.0' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://www.volcengine.com/docs/6561/79820', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://www.volcengine.com/docs/6561/79820', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
