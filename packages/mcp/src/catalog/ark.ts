/**
 * 方舟 MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `src/derive.ts` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 */
import type { CatalogEntry } from './types'

const okOutput = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
  additionalProperties: true,
}

export default [
  {
    name: 'chat',
    description:
      '调用方舟语言/多模态模型。其他方舟模型（含目录中的 DeepSeek）传完整ID。不同平台的型号与权限不可通用。\n' +
      'images支持本地图片或URL，videos为公网URL。history用Chat消息格式，工具不保存对话。\n' +
      'web_search=true或传previous_response_id时使用Responses API，保留sources和response_id；否则走Chat API。\n' +
      'thinking=true/false映射enabled/disabled；最新API不再列出auto。json_mode要求提示词明确JSON结构；parameters透传模型支持的高级字段。\n' +
      'parameters.prompt_cache_key为可选缓存路由标识，Chat与Responses均支持；省略不关闭隐式缓存，设置也不保证命中。\n' +
      '同一Endpoint和模型下连续上下文复用不可读内部Session ID，不同用户或并行会话使用不同值；不要传个人信息、凭证或prompt原文。\n' +
      '官方建议单key总流量低于每分钟15个请求；这是路由建议而非硬限流，扩缩容等仍可能重新路由。\n' +
      '返回content、reasoning、usage；include_response=true可取完整response。按token与搜索调用计费，模型和搜索服务须已开通；尚未完成云端验证。\n',
    capability: 'text.chat',
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
        videos: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        thinking: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        max_tokens: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        temperature: { anyOf: [{ type: 'number' }, { type: 'null' }], default: null },
        json_mode: { type: 'boolean', default: false },
        web_search: { type: 'boolean', default: false },
        previous_response_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        include_response: {
          type: 'boolean',
          default: false,
          description: '返回原始响应，默认false',
        },
      },
      required: ['prompt'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'embed',
    description:
      '方舟文本/多模态向量化，model必须显式指定。texts为文本列表；contents用官方格式，如\n' +
      '[{"type":"text","text":"猫"},{"type":"image_url","image_url":{"url":"/absolute/cat.png"}}]。\n' +
      '两项只能选一项；图片支持本地路径，视频须URL。parameters支持instructions、multi_embedding等模型选项。\n' +
      '保留data和usage，不自动建索引或知识库；按输入计费。尚未完成云端验证。百炼 text-embedding / qwen3-vl-embedding 及 rerank 用 ali-bailian。\n',
    capability: 'text.embed',
    inputSchema: {
      type: 'object',
      title: 'embedArguments',
      properties: {
        model: { type: 'string' },
        texts: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        contents: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
        dimensions: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        include_response: {
          type: 'boolean',
          default: false,
          description: '返回原始响应，默认false',
        },
      },
      required: ['model'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'generate_image',
    description:
      'Seedream 生成或编辑图片；图层拆分、透明背景、组图选这里，海报文字渲染可改用 ali-bailian 的 qwen。' +
      'images为本地路径或URL；layers/transparent只能传1张。宽高比写入prompt。按成功张数计费，组图/图层会生成多张。' +
      '返回job_id、job_state、files、artifacts、usage；recover_job只补交付。未列出的官方字段放parameters。完整尺寸、图层与提示词用法见get_tool_help。\n',
    capability: 'image.generate',
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
        transparent: { type: 'boolean', default: false },
        layers: { type: 'boolean', default: false },
        group: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        web_search: { type: 'boolean', default: false },
        fast: { type: 'boolean', default: false },
        watermark: { type: 'boolean', default: false },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'generate_video',
    description:
      '调用火山方舟 Seedance 生成视频，也可传完整模型或 Endpoint ID。本地参考视频/音频需改用 ali-bailian 的 generate_video（自动上传）。\n' +
      '支持文生、首帧、首尾帧、多模态参考；编辑任务可在 prompt 明确写视频编辑或延长意图。\n' +
      '图片支持本地路径/URL，参考视频和音频须公网 URL 或 asset://ID；本工具不上传本地视频/音频。\n' +
      '具体素材数量、时长、分辨率由模型校验。parameters 透传官方顶层选项，如 draft、return_last_frame、output_format、omni_reference_task_type。\n' +
      'draft=true 须用 480p，Draft ID 自 created_at 起有效，2026-10-28 10:00(UTC+8)起创建的为 14 天、此前 7 天；本工具尚不支持 content.draft_task 转正式成片。\n' +
      '首尾帧与参考素材互斥。wait=0 默认只提交，1–90 秒可轮询，返回 task_id/job_id；之后用 get_job 查进度并在完成时自动下载，下载失败用 recover_job 补。\n' +
      '按生成视频计费；账户需开通模型。所有新增能力尚未完成云端验证，返回文件仅表示下载完成。\n',
    capability: 'video.generate',
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
    outputSchema: okOutput,
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
        include_response: {
          type: 'boolean',
          default: false,
          description: '返回原始响应，默认false',
        },
      },
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
    description:
      '列出本MCP的方舟能力和官方来源，不联网，不代表当前账号权限；新增功能尚未完成云端验证。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
    outputSchema: okOutput,
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
    outputSchema: okOutput,
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
        include_response: {
          type: 'boolean',
          default: false,
          description: '返回原始响应，默认false',
        },
      },
      required: ['job_id'],
    },
    outputSchema: okOutput,
  },
] satisfies CatalogEntry[]
