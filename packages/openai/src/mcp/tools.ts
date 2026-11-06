/**
 * OpenAI MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、画幅 / 张数 / 参考图等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 *
 * 只覆盖官方渠道（`openai`）；OpenAI 兼容渠道的模型 ID 由使用方自定，没有声明可派生。
 */
import type { ToolSpec } from '@modelbay/core'

const okOutput = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
  additionalProperties: true,
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }], default: null })

/**
 * 把扁平字段与 `parameters` 收进 `extra`，交给适配器按声明的 `optionsSchema` 校验。
 * 显式扁平字段优先于 `parameters`。
 */
function intoExtra(
  args: Record<string, unknown>,
  flat: Record<string, string>,
): Record<string, unknown> {
  const { parameters, ...rest } = args
  const extra: Record<string, unknown> = {
    ...(typeof parameters === 'object' && parameters !== null ? parameters : {}),
  }
  for (const [field, key] of Object.entries(flat)) {
    if (rest[field] !== undefined) extra[key] = rest[field]
    delete rest[field]
  }
  return Object.keys(extra).length > 0 ? { ...rest, extra } : rest
}

export const openaiTools: ToolSpec[] = [
  {
    name: 'chat',
    description:
      '调用 OpenAI 官方对话模型（Responses API）。history 用 Chat 消息格式，不含本轮 prompt，工具不保存对话；images 支持本地路径或 URL。\n' +
      'reasoning_effort 控制思考强度，verbosity 控制回答详略；默认 store=false，不在 OpenAI 侧保存响应。\n' +
      '其他字段（service_tier、prompt_cache_key、previous_response_id、truncation 等）放 parameters：声明里有的按声明校验取值，没有的原样传给 Responses API。\n' +
      '返回 content、reasoning、usage，按 token 计费。完整用法见 get_tool_help。\n',
    capability: 'text.chat',
    // 字段名与取值见各模型声明的 optionsSchema。
    // 来源：https://developers.openai.com/api/docs/models/gpt-6.1-terra（核对日期 2026-11-05）
    mapArguments: (args) =>
      intoExtra(args, { reasoning_effort: 'reasoning_effort', verbosity: 'verbosity' }),
    inputSchema: {
      type: 'object',
      title: 'chatArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        system: nullable('string'),
        history: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
        images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        reasoning_effort: nullable('string'),
        verbosity: nullable('string'),
        max_tokens: nullable('integer'),
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'generate_image',
    description:
      '调用 OpenAI 生图模型生成图片；传 images（本地路径或 URL）时按参考图编辑。\n' +
      'aspect_ratio 选画幅，size 填 auto 或 宽x高（优先于 aspect_ratio），n 为张数；quality、background（transparent 需 png/webp）、output_format（png/jpeg/webp/svg/gif）直接对应接口字段。\n' +
      '其他声明支持的字段（complexity、output_compression、moderation、frame_count 等）放 parameters，声明外的字段会报错。\n' +
      '同步返回 files、artifacts、usage，给 out_dir 时落盘。按张数与画质计费。完整用法见 get_tool_help。\n',
    capability: 'image.generate',
    // 适配器从 extra.aspectRatio / extra.size 换算尺寸，其余字段按声明 optionsSchema 透传。
    // 来源：https://developers.openai.com/api/docs/guides/image-generation（核对日期 2026-11-05）
    mapArguments: (args) =>
      intoExtra(args, {
        aspect_ratio: 'aspectRatio',
        size: 'size',
        quality: 'quality',
        background: 'background',
        output_format: 'output_format',
      }),
    modelParams: { aspect_ratio: 'aspectRatio', n: 'count', images: 'references' },
    inputSchema: {
      type: 'object',
      title: 'generate_imageArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        aspect_ratio: nullable('string'),
        size: nullable('string'),
        n: nullable('integer'),
        quality: nullable('string'),
        background: nullable('string'),
        output_format: nullable('string'),
        out_dir: nullable('string'),
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'get_tool_help',
    description: '按工具名读取完整用法、模型限制与示例，不联网、不计费。',
    inputSchema: {
      type: 'object',
      title: 'get_tool_helpArguments',
      properties: { tool: { type: 'string' } },
      required: ['tool'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'list_capabilities',
    description: '列出本 MCP 的 OpenAI 能力和官方来源，不联网，不代表当前账号权限。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
    outputSchema: okOutput,
  },
  {
    name: 'list_jobs',
    description:
      '列出最近本地任务，不联网。工具超时未拿到结果时可按时间/model/summary 找回记录；limit=1–100，kind 可筛选 text/image。',
    inputSchema: {
      type: 'object',
      title: 'list_jobsArguments',
      properties: {
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        kind: nullable('string'),
      },
    },
    outputSchema: okOutput,
  },
]
