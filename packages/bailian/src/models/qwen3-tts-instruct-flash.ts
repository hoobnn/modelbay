import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-tts-instruct-flash：官方已于 2026-10-10 下线，只保留给旧画布引用。
 *
 * 公告「部分老旧模型下线通知」原文：「大模型服务平台百炼将于 2026 年 10 月 10 日对下表中的模型
 * 进行下线处理」，表中列出本模型，推荐替代为 cosyvoice-v3.5-plus。模型下线页把这条公告归在
 * 「2026年10月10日已下线」下，当前模型总览里也没有这个型号。
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
      url: 'https://www.aliyun.com/notice/118434',
      checkedAt: '2026-11-05',
    },
  },
  source: { url: 'https://help.aliyun.com/zh/model-studio/models', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
