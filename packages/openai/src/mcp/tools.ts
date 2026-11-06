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

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }], default: null })

/** 由 MCP 层或通用换算处理、不进 `extra` 的字段（见 docs/mcp.md「路由与元数据」）。 */
const MCP_FIELDS = ['model', 'wait', 'out_dir', 'output_directory']

/**
 * 除 `keep` 以外的参数都收进 `extra`，交给适配器按声明的 `optionsSchema` 校验：
 * 包括工具目录里的扁平字段和运行时从声明派生出的顶层字段（如 `previous_response_id`），
 * 不会因为没列进白名单被悄悄丢掉。`rename` 把 MCP 字段名换成适配器读的键；
 * 显式顶层字段优先于 `parameters`。
 */
function intoExtra(
  args: Record<string, unknown>,
  keep: string[],
  rename: Record<string, string> = {},
): Record<string, unknown> {
  const { parameters, ...rest } = args
  const kept: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {
    ...(typeof parameters === 'object' && parameters !== null ? parameters : {}),
  }
  for (const [key, value] of Object.entries(rest)) {
    if (keep.includes(key) || MCP_FIELDS.includes(key)) kept[key] = value
    else extra[rename[key] ?? key] = value
  }
  return Object.keys(extra).length > 0 ? { ...kept, extra } : kept
}

export const openaiTools: ToolSpec[] = [
  {
    name: 'chat',
    description:
      '调用 OpenAI 官方对话模型（Responses API）。history 用 Chat 消息格式，不含本轮 prompt，工具不保存对话；images 支持本地路径或 URL。\n' +
      'reasoning_effort 控制思考强度，verbosity 控制回答详略；默认 store=false，不在 OpenAI 侧保存响应。\n' +
      '其他声明字段（service_tier、prompt_cache_key、previous_response_id、truncation 等）可直接传或放 parameters，按声明校验取值；parameters 里声明外的字段原样传给 Responses API。\n' +
      '返回 content、reasoning、usage，按 token 计费。完整用法见 get_tool_help。\n',
    capability: 'text.chat',
    // 字段名与取值见各模型声明的 optionsSchema。
    // 来源：https://developers.openai.com/api/docs/models/gpt-6.1-terra（核对日期 2026-11-05）
    mapArguments: (args) =>
      intoExtra(args, ['prompt', 'system', 'history', 'images', 'max_tokens', 'temperature']),
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
  },
  {
    name: 'generate_image',
    description:
      '调用 OpenAI 生图模型生成图片；传 images（本地路径或 URL）时按参考图编辑。\n' +
      'aspect_ratio 选画幅，size 填 auto 或 宽x高（优先于 aspect_ratio），n 为张数；quality、background（transparent 需 png/webp）、output_format（png/jpeg/webp/svg/gif）直接对应接口字段。\n' +
      '其他声明支持的字段（complexity、output_compression、moderation、frame_count 等）可直接传或放 parameters，声明外的字段会报错。\n' +
      '同步返回结果，不建任务记录；给 out_dir 时落盘。按张数与画质计费。完整用法见 get_tool_help。\n',
    capability: 'image.generate',
    // 适配器从 extra.aspectRatio / extra.size 换算尺寸，其余字段按声明 optionsSchema 透传。
    // 来源：https://developers.openai.com/api/docs/guides/image-generation（核对日期 2026-11-05）
    mapArguments: (args) =>
      intoExtra(args, ['prompt', 'images', 'n'], { aspect_ratio: 'aspectRatio' }),
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
  },
  {
    name: 'list_capabilities',
    description: '列出本 MCP 的 OpenAI 能力和官方来源，不联网，不代表当前账号权限。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
  },
]
