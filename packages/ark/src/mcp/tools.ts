/**
 * 方舟 MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 */
import type { ToolSpec } from '@modelbay/core'

/**
 * 把 MCP 的扁平字段与 `parameters` 收进 `extra`（适配器按白名单放行，白名单外的键会报错而不是静默忽略）。
 * 已有 `extra` 不覆盖：显式扁平字段优先于 `parameters`。
 */
function intoExtra(
  args: Record<string, unknown>,
  flat: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const { parameters, ...rest } = args
  const merged: Record<string, unknown> = {
    ...(typeof parameters === 'object' && parameters !== null ? parameters : {}),
    ...extra,
  }
  for (const key of flat) {
    if (rest[key] !== undefined) merged[key] = rest[key]
    delete rest[key]
  }
  return { ...rest, extra: merged }
}

export const arkTools: ToolSpec[] = [
  {
    name: 'chat',
    description:
      '调用方舟语言/多模态模型。其他方舟模型（含目录中的 DeepSeek）传完整ID。不同平台的型号与权限不可通用。\n' +
      'images支持本地图片或URL。history用Chat消息格式，工具不保存对话。\n' +
      'thinking=true/false映射enabled/disabled；不传则按模型默认。parameters透传模型支持的高级字段：top_p、frequency_penalty、presence_penalty、prompt_cache_key，其余字段会报错。\n' +
      'parameters.prompt_cache_key为可选缓存路由标识；省略不关闭隐式缓存，设置也不保证命中。\n' +
      '同一Endpoint和模型下连续上下文复用不可读内部Session ID，不同用户或并行会话使用不同值；不要传个人信息、凭证或prompt原文。\n' +
      '官方建议单key总流量低于每分钟15个请求；这是路由建议而非硬限流，扩缩容等仍可能重新路由。\n' +
      '返回content、reasoning、usage。按token计费，模型须已开通；尚未完成云端验证。\n',
    capability: 'text.chat',
    // Chat API `thinking.type` 取 enabled / disabled。
    // 来源：https://docs.volcengine.com/docs/82379/1494384（核对日期 2026-11-06）
    mapArguments: (args) =>
      intoExtra(
        Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'thinking')),
        [],
        typeof args.thinking === 'boolean'
          ? { thinking: { type: args.thinking ? 'enabled' : 'disabled' } }
          : {},
      ),
    inputSchema: {
      type: 'object',
      title: 'chatArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        system: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
        thinking: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        max_tokens: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        temperature: { anyOf: [{ type: 'number' }, { type: 'null' }], default: null },
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
      'Seedream 生成或编辑图片，海报文字渲染可改用 ali-bailian 的 qwen。' +
      'images为本地路径或URL。宽高比写入prompt。size取档位（如2K）或宽x高像素，具体可选值随模型。fast=true使用快速提示词优化（部分模型不支持）。按成功张数计费。' +
      '返回job_id、job_state、files、artifacts、usage；recover_job只补交付。parameters仅支持watermark、output_format、size、optimize_prompt_options，其余字段会报错。\n',
    capability: 'image.generate',
    // size（档位或 WxH 像素）/ output_format / watermark / optimize_prompt_options 都是 /images/generations 的顶层字段；
    // fast=true 对应 optimize_prompt_options.mode = 'fast'（可选 standard / fast）。
    // 档位写进归一化的 resolution，由适配器按声明校验并换算尺寸；像素值原样走 extra.size。
    // 来源：https://docs.volcengine.com/docs/82379/1541523（核对日期 2026-11-06）
    mapArguments: (args) => {
      const { fast, size, ...rest } = args
      const pixels = typeof size === 'string' && /^\d+x\d+$/.test(size)
      return intoExtra(
        { ...rest, ...(typeof size === 'string' && !pixels ? { resolution: size } : {}) },
        ['output_format', 'watermark'],
        {
          ...(pixels ? { size } : {}),
          ...(fast === true ? { optimize_prompt_options: { mode: 'fast' } } : {}),
        },
      )
    },
    modelParams: { size: 'resolution' },
    inputSchema: {
      type: 'object',
      title: 'generate_imageArguments',
      properties: {
        prompt: { type: 'string', default: '' },
        model: { type: 'string' },
        images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        size: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        output_format: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        fast: { type: 'boolean', default: false },
        watermark: { type: 'boolean', default: false },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
  },
  {
    name: 'generate_video',
    description:
      '调用火山方舟 Seedance 生成视频，也可传完整模型或 Endpoint ID。本地参考视频/音频需改用 ali-bailian 的 generate_video（自动上传）。\n' +
      '支持文生、首帧、首尾帧、多模态参考；编辑任务可在 prompt 明确写视频编辑或延长意图。\n' +
      '图片支持本地路径/URL，参考视频和音频须公网 URL 或 asset://ID；本工具不上传本地视频/音频。\n' +
      '具体素材数量、时长、分辨率由模型校验。parameters 透传官方顶层选项：draft、return_last_frame、service_tier、execution_expires_after、output_format、omni_reference_task_type、adaptive_duration，其余字段会报错。\n' +
      'draft=true 须用 480p，Draft ID 自 created_at 起有效，2026-10-28 10:00(UTC+8)起创建的为 14 天、此前 7 天；本工具尚不支持 content.draft_task 转正式成片。\n' +
      '首尾帧与参考素材互斥。wait=0 默认只提交，1–90 秒可轮询，返回 task_id/job_id；之后用 get_job 查进度并在完成时自动下载，下载失败用 recover_job 补。\n' +
      '按生成视频计费；账户需开通模型。所有新增能力尚未完成云端验证，返回文件仅表示下载完成。\n',
    capability: 'video.generate',
    // watermark / service_tier / draft / return_last_frame / output_format / omni_reference_task_type /
    // execution_expires_after 都是创建任务请求的顶层字段（generate_audio 由 audio 经归一化输入给出）。
    // 来源：https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh（核对日期 2026-11-06）
    mapArguments: (args) =>
      intoExtra(args, [
        'watermark',
        'adaptive_duration',
        'return_last_frame',
        'service_tier',
        'omni_reference_task_type',
        'draft',
      ]),
    modelParams: {
      resolution: 'resolution',
      ratio: 'aspectRatio',
      duration: 'duration',
      seed: 'seed',
    },
    inputSchema: {
      type: 'object',
      title: 'generate_videoArguments',
      properties: {
        prompt: { type: 'string', default: '' },
        model: { type: 'string' },
        first_frame: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        last_frame: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        reference_images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        reference_videos: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        reference_audios: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        resolution: { type: 'string' },
        ratio: { type: 'string' },
        duration: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        audio: { type: 'boolean', default: true },
        watermark: { type: 'boolean', default: false },
        seed: {
          anyOf: [{ type: 'integer' }, { type: 'null' }],
          default: null,
          description:
            '随机种子，仅部分模型支持；声明里的 Seedance 系列均不支持，传整数会被拒绝，不传或 null 表示不指定',
        },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
  },
  {
    name: 'get_job',
    description:
      '查任务进度和结果，job_id 或 task_id 二选一（都给时须属于同一任务）。\n' +
      '视频还在生成时查询方舟一次（wait 1–90 秒可轮询），完成即下载到原输出目录；已结束的任务只读本地记录。\n' +
      '只给 task_id 且本地没有记录（如别处提交的 Seedance 任务）时，新建本地记录再查询。不会重新提交生成。\n' +
      '返回 job_state（running/delivered/failed/download_failed 等）、completed、files、usage；ok=false 表示查询或交付失败。\n',
    inputSchema: {
      type: 'object',
      title: 'get_jobArguments',
      properties: {
        job_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        task_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
      },
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
    description:
      '列出本MCP的方舟能力和官方来源，不联网，不代表当前账号权限；新增功能尚未完成云端验证。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
  },
  {
    name: 'list_jobs',
    description:
      '列出最近本地任务，不联网。工具超时未拿到job_id时可按时间/model/summary找回记录；limit=1–100，kind可筛选image/video/tts等。',
    inputSchema: {
      type: 'object',
      title: 'list_jobsArguments',
      properties: {
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        kind: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
    },
  },
  {
    name: 'recover_job',
    description:
      '修复已有任务的交付：图片只补下载；视频重新查询原task_id刷新结果URL再下载。跳过校验完整的本地文件。\n' +
      '正常查进度用 get_job；本工具用于 download_failed 或链接过期。\n' +
      '不重新生成；状态未知且没有task_id的任务不可自动恢复。wait=0查一次，最多90秒。临时链接过期可能无法恢复。\n',
    inputSchema: {
      type: 'object',
      title: 'recover_jobArguments',
      properties: {
        job_id: { type: 'string' },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
      },
      required: ['job_id'],
    },
  },
]
