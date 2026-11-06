import type { ModelDeclaration } from '@modelbay/core'

/**
 * 豆包向量模型：文本与多模态（图文）向量化。
 *
 * 按量渠道用日期快照 ID，套餐渠道用不带日期的 ID（官方「套餐概览」页只列后者）。
 *
 * 来源：https://docs.volcengine.com/docs/ark/model-list?lang=zh 与
 * https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview（2026-11-05 核对）
 */
export default {
  canonicalId: 'volc/doubao-embedding-vision',
  id: 'doubao-embedding-vision',
  title: 'doubao-embedding-vision',
  description: '豆包向量模型：文本与多模态向量化。',
  capabilities: ['text.embed'],
  channels: [
    { channel: 'ark', id: 'doubao-embedding-vision-251215' },
    {
      channel: 'ark-plan',
      id: 'doubao-embedding-vision',
      source: {
        url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
        checkedAt: '2026-11-05',
      },
    },
  ],
  // 多模态向量化 POST /embeddings/multimodal 的请求参数，取值与限制来自：
  // https://docs.volcengine.com/docs/82379/1523520（2026-11-06 核对原文）
  // 视频抽帧参数（fps 等）在 input 的 video_url 对象里，属于单条输入，不在这里声明。
  optionsSchema: {
    type: 'object',
    properties: {
      dimensions: {
        title: '向量维度',
        type: 'integer',
        enum: [1024, 2048],
        description: '输出的向量维度，官方默认 2048',
      },
      encoding_format: {
        title: '返回格式',
        type: 'string',
        enum: ['float', 'base64'],
        description: '稠密向量的返回格式，官方默认 float',
      },
      instructions: {
        title: '推理提示词',
        type: 'string',
        description:
          '推理提示词，未传时按输入模态生成默认值；官方提示该字段直接决定效果，建议按业务场景定制。仅 doubao-embedding-vision-251215 及后续版本支持',
      },
      multi_embedding: {
        title: '多向量配置',
        type: 'object',
        description:
          '多向量输出配置，开启后额外返回 token 级向量；不允许传空对象，至少包含 type。仅 doubao-embedding-vision-251215 及后续版本支持',
        properties: {
          type: { title: '多向量开关', type: 'string', enum: ['disabled', 'enabled'] },
          compression: {
            title: '多向量压缩',
            type: 'string',
            enum: ['blosc2', 'zstd'],
            description: '仅 type 为 enabled 时生效；不传则不压缩',
          },
        },
        required: ['type'],
      },
      sparse_embedding: {
        title: '稀疏向量配置',
        type: 'object',
        description: '稀疏向量开关，仅纯文本输入支持',
        properties: {
          type: { title: '稀疏向量开关', type: 'string', enum: ['disabled', 'enabled'] },
        },
        required: ['type'],
      },
    },
  },
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
