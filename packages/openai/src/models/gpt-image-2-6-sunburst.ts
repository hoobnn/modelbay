import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'openai/gpt-image-2.6-sunburst',
  id: 'gpt-image-2.6-sunburst',
  title: 'gpt-image-2.6-sunburst',
  capabilities: ['image.generate', 'image.edit'],
  description: '支持多参考图与蒙版引导编辑；蒙版边界不保证像素级保留。',
  limits: {
    promptMaxLength: 32000,
    aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
    count: { max: 10 },
    references: { max: 16 },
    seed: false,
  },
  optionsSchema: {
    type: 'object',
    properties: {
      quality: {
        title: '画质',
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high'],
      },
      size: {
        title: '输出尺寸',
        type: 'string',
        pattern: '^(auto|[1-9][0-9]*x[1-9][0-9]*)$',
        default: 'auto',
        'x-multiple': 16,
        'x-aspectRatioSizes': {
          '1:1': '1024x1024',
          '3:2': '1536x1024',
          '2:3': '1024x1536',
          '16:9': '1536x864',
          '9:16': '864x1536',
        },
      },
      complexity: {
        title: '构图复杂度',
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'high',
      },
      // 指南写 2–64，接口参考写 2–16；先取两者交集，见 docs/openai.md。
      frame_count: { title: 'GIF 帧数', type: 'integer', minimum: 2, maximum: 16, default: 9 },
      frame_duration_ms: {
        title: 'GIF 帧间隔',
        type: 'integer',
        minimum: 20,
        maximum: 2000,
        default: 200,
      },
      svg: {
        title: 'SVG 作者设置',
        type: 'object',
        required: ['model'],
        properties: {
          model: { type: 'string', minLength: 1 },
          reasoning: {
            type: 'object',
            properties: {
              effort: {
                type: 'string',
                enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
              },
            },
          },
        },
      },
      output_compression: { title: '输出压缩', type: 'integer', minimum: 0, maximum: 100 },
      moderation: { title: '内容过滤', type: 'string', enum: ['auto', 'low'] },
      safety_identifier: { title: '安全标识', type: 'string', maxLength: 128 },
      markup: {
        title: '标记层',
        type: 'object',
        properties: { image_url: { type: 'string' }, file_id: { type: 'string' } },
      },
      background: { title: '背景', type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      output_format: {
        title: '输出格式',
        type: 'string',
        enum: ['png', 'jpeg', 'webp', 'svg', 'gif'],
        default: 'png',
      },
    },
  },
  channels: [{ channel: 'openai', id: 'gpt-image-2.6-sunburst' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://developers.openai.com/api/docs/guides/image-generation',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://developers.openai.com/api/docs/guides/image-generation',
    checkedAt: '2026-11-05',
  },
} satisfies ModelDeclaration
