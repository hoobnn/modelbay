import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-tts-instruct-flash：官方已于 2026-10-10 下线，只保留给旧画布引用。
 *
 * 官方「语音合成概述」的 Qwen3-TTS 只列 qwen3-tts-flash-realtime 与 qwen3-tts-flash，
 * 模型总览里也已经没有这个型号。下线状态的来源是阿里云公告页；公告页正文由前端渲染，
 * 这里没能读到原文，所以 checkedAt 不是核对正文的日期，待核对。
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
    status: 'retired',
    source: {
      url: 'https://www.alibabacloud.com/zh/notice/detail?id=2009',
      checkedAt: '2026-10-31',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
