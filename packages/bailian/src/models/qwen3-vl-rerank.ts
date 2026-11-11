import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-vl-rerank：百炼的多模态重排序模型，接口与 qwen3.7-text-rerank 相同（text-rerank 原生接口）。
 *
 * 官方 query / documents 可以是字符串，也可以是 {text} / {image} / {video} 对象；
 * native rerank 目前只收文本，所以这里先按文本重排使用。
 * 重排序在 0003 里没有对应的归一化能力，走 native（rerank），能力取最接近的 text.embed。
 *
 * 来源（2026-11-11 核对）：https://help.aliyun.com/zh/model-studio/text-rerank-api
 * 「字符串格式：直接传入文本字符串」；只支持 DashScope 接口，「不支持 OpenAI 兼容接口」。
 */
export default {
  canonicalId: 'aliyun/qwen3-vl-rerank',
  id: 'qwen3-vl-rerank',
  title: 'qwen3-vl-rerank',
  description: '多模态重排序：按与查询的相关性给候选文档打分排序（当前只收文本）。',
  capabilities: ['text.embed'],
  native: ['rerank'],
  channels: [{ channel: 'bailian', id: 'qwen3-vl-rerank' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/embedding-rerank-model',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/text-rerank-api',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
