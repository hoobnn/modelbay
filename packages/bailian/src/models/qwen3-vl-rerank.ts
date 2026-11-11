import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen3-vl-rerank：百炼的多模态重排序模型，接口与 qwen3.7-text-rerank 相同（text-rerank 原生接口）。
 *
 * 官方 query 可以是字符串或 {text} / {image}，documents 可以是字符串或 {text} / {image} / {video}
 * （图片收 URL 或 Data URI，视频只收公网 URL；每次最多文本 100、图片 40、视频 4 个）。
 * 重排序在 0003 里没有对应的归一化能力，走 native（rerank），能力取最接近的 text.embed。
 *
 * 来源（2026-11-11 核对）：https://help.aliyun.com/zh/model-studio/text-rerank-api
 * 只支持 DashScope 接口，「不支持 OpenAI 兼容接口」；parameters.fps「仅 qwen3-vl-rerank…取值范围 [0, 1]，默认 1.0」。
 */
export default {
  canonicalId: 'aliyun/qwen3-vl-rerank',
  id: 'qwen3-vl-rerank',
  title: 'qwen3-vl-rerank',
  description:
    '多模态重排序：查询可以是文本或图片，候选可以混合文本、图片（URL 或 Data URI）和视频（公网 URL），按相关性打分排序。',
  capabilities: ['text.embed'],
  native: ['rerank'],
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      fps: {
        title: '视频抽帧比例',
        description: '官方默认 1.0；值越小抽的帧越少，仅对视频候选生效',
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
    },
  },
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
