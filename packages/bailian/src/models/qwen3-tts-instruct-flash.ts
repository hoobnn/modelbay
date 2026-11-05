import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-tts-instruct-flash：官方已下线，只保留给旧画布引用。
 *
 * 官方「语音合成概述」的 Qwen3-TTS 只列 qwen3-tts-flash-realtime 与 qwen3-tts-flash，
 * 模型总览里也已经没有这个型号；但官方没有单独的下线公告原文，
 * 按 0003 的硬规则，生命周期状态保持 active，等拿到公告原文再改。
 */
export default {
  canonicalId: 'aliyun/qwen3-tts-instruct-flash',
  id: 'qwen3-tts-instruct-flash',
  title: 'qwen3-tts-instruct-flash',
  description: '已于 2026-10-10 下线；仅保留旧画布引用，请改用 qwen3-tts-flash 或豆包语音',
  capabilities: ['audio.speech'],
  limits: { speed: false, instruction: false, promptMaxLength: 600 },
  channels: [{ channel: 'bailian', id: 'qwen3-tts-instruct-flash' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
