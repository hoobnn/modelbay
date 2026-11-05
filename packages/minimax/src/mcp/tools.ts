/**
 * MiniMax MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 */
import type { ToolSpec } from '@modelbay/core'

const okOutput = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
  additionalProperties: true,
}

export const minimaxTools: ToolSpec[] = [
  {
    name: 'create_h3_context_ir_task',
    native: 'context-ir',
    description:
      '创建 H3-Context-IR 任务（官方 POST /v2/h3_context_ir）：深度理解多模态输入，异步返回结构化增强提示词，不直接生成视频；按Token计费。\n' +
      '纯文本传prompt，多模态传官方content数组（二选一）；素材/组合限制同generate_video。\n' +
      'parameters仅支持callback_url。wait=0只提交，后续get_job返回prompt及prompt.txt；需要生成视频时把返回的prompt交给generate_video。\n',
    capability: 'video.generate',
    modelParams: { duration: 'duration', ratio: 'aspectRatio' },
    inputSchema: {
      type: 'object',
      title: 'create_h3_context_ir_taskArguments',
      properties: {
        prompt: { type: 'string', default: '' },
        content: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
        duration: { type: 'integer' },
        ratio: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'delete_video_task',
    native: 'video-task-delete',
    nature: 'mutate',
    group: 'management',
    description:
      '取消queued任务，或删除succeeded/failed任务的云端记录；running任务不支持取消。\n' +
      '会影响云端任务，仅用户要求取消/删除时调用；保留本地已下载文件。admin工具组默认关闭。\n',
    inputSchema: {
      type: 'object',
      title: 'delete_video_taskArguments',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'generate_video',
    description:
      'MiniMax H3 V2 音画视频生成，支持文生、首帧、尾帧、首尾帧和多模态参考。按量计费。\n' +
      '多模态参考须显式给具体ratio。prompt 与快捷素材参数可组合；或单独传官方 content 数组，不能混用。所有模式需要1个非空text。\n' +
      '素材接受公网URL、mm_file://ID、data URI或本地绝对路径；本地文件自动上传，有效期7天。\n' +
      '首/尾帧各最多1张，与参考素材互斥。具体素材数量、时长、分辨率与文件大小上限见下面的模型清单。\n' +
      'ratio省略时文生为16:9，其余adaptive；首尾帧总是跟随图片比例。parameters支持callback_url/aigc_watermark；不允许覆盖模型或content。\n' +
      'wait=0只提交，最多等待90秒；返回job_id/task_id，get_job后续查询及下载，recover_job只补交付不重新生成。\n' +
      '工具超时可用list_jobs找回。HTTP超时且无task_id时不自动重试，避免重复付费。离线契约已测试，账号权限需实际调用验证。\n',
    capability: 'video.generate',
    modelParams: {
      duration: 'duration',
      resolution: 'resolution',
      ratio: 'aspectRatio',
    },
    inputSchema: {
      type: 'object',
      title: 'generate_videoArguments',
      properties: {
        prompt: { type: 'string', default: '' },
        model: { type: 'string' },
        content: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
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
        duration: { type: 'integer' },
        resolution: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        ratio: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
      '查本地任务；H3排队/运行时查询云端，完成即下载，wait最多90秒。支持采用外部提交的V2 task_id。\n' +
      '返回completed=false表示仍在进行；失败返回ok=false。同步媒体任务只读本地结果，补下载用recover_job。\n',
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
    description: '列出本MCP已实现能力与官方来源，不联网；不是账号权限/模型在线可用性证明。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
    outputSchema: okOutput,
  },
  {
    name: 'list_jobs',
    description:
      '列出本地任务，不联网；超时后按时间找回job_id。kind为video/image/speech/music/voice_clone/voice_design。',
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
    name: 'list_video_tasks',
    native: 'video-task-list',
    nature: 'query',
    group: 'management',
    description:
      '分页查询云端最近7天H3任务，不下载。task_type为generation/h3_context_ir/regeneration。\n' +
      'status为queued/running/succeeded/failed/cancelled；本地历史记录用list_jobs。\n',
    inputSchema: {
      type: 'object',
      title: 'list_video_tasksArguments',
      properties: {
        page_num: { type: 'integer', default: 1 },
        page_size: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        status: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        task_ids: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        model: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        task_type: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'list_voices',
    description:
      '查询本账号可用音色；voice_type为all/system/voice_cloning/voice_generation，不生成语音。',
    inputSchema: {
      type: 'object',
      title: 'list_voicesArguments',
      properties: { voice_type: { type: 'string', default: 'all' } },
    },
    outputSchema: okOutput,
  },
  {
    name: 'music_generation',
    description:
      '生成歌曲或纯音乐，生成计费。人声歌曲须lyrics或lyrics_optimizer=true；纯音乐设is_instrumental=true并填写prompt。\n' +
      '官方2026-08-20公告：付费音乐API仅历史付费用户可继续使用，免费接口已停止。账号可用性以服务端为准。\n' +
      '当前文档指向 MiniMax-Music3 开源模型作为其他使用方式；该开源模型不属于本工具的API model枚举。\n' +
      'parameters支持audio_setting等官方字段，不支持stream；结果可recover_job补下载。\n',
    capability: 'audio.music',
    modelParams: { prompt: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'music_generationArguments',
      properties: {
        prompt: { type: 'string', default: '' },
        lyrics: { type: 'string', default: '' },
        model: { type: 'string' },
        is_instrumental: { type: 'boolean', default: false },
        lyrics_optimizer: { type: 'boolean', default: false },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'query_video_generation',
    native: 'video-task-query',
    nature: 'query',
    description:
      '查询H3 V2任务（generation/h3_context_ir/regeneration），成功后下载或返回URL，不重新生成。\n' +
      '保留官方MCP工具名，但不支持旧V1任务。平台查询窗口7天；未知task_id会建立本地记录，已有记录沿用原输出目录。\n',
    inputSchema: {
      type: 'object',
      title: 'query_video_generationArguments',
      properties: {
        task_id: { type: 'string' },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
      },
      required: ['task_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'recover_job',
    description:
      '只修复交付，不重新生成。H3按原task_id刷新链接后下载；同步产物复用保存的URL/音频。\n' +
      '校验完好的文件跳过下载。无task_id的未知提交不重试；同步URL过期后可能无法恢复。\n',
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
  {
    name: 'regenerate_video',
    native: 'video-2k-rerender',
    group: 'management',
    description:
      '创建视频再生成任务（官方 POST /v2/video_regeneration）：将符合MiniMax-H3 768P输出规格的视频再生成为2K，单独计费；不是任意视频放大。\n' +
      'source_task_id与content二选一。按ID需要白名单、属于本账号且7天内成功生成的源任务。\n' +
      'content须原样包含源视频生成时最终prompt和全部参考素材，加且只加1个type=video_url/role=base_video项。\n' +
      '源视频须带音轨、24fps、宽高均可被32整除，像素面积589824–1032192，总帧数107–362且每档递增17帧。\n' +
      '本地输入自动上传；parameters支持callback_url/aigc_watermark。返回task_id/job_id，后续get_job查询并下载。\n',
    capability: 'video.generate',
    inputSchema: {
      type: 'object',
      title: 'regenerate_videoArguments',
      properties: {
        source_task_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        content: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
        wait: { type: 'integer', default: 0, minimum: 0, maximum: 90 },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'text_to_audio',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    aliases: ['text_to_speech'],
    description:
      '同步语音合成，按字符计费。voice_id用list_voices获取；speed=0.5–2，vol=(0,10]，pitch=-12–12，format=mp3/wav/flac/pcm。\n' +
      'parameters深度合并voice_setting/audio_setting等官方选项，不支持stream；结果持久保存，可recover_job补下载。\n',
    capability: 'audio.speech',
    modelParams: { speed: 'speed', text: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'text_to_audioArguments',
      properties: {
        text: { type: 'string' },
        voice_id: { type: 'string' },
        model: { type: 'string' },
        speed: { type: 'number', default: 1 },
        vol: { type: 'number', default: 1 },
        pitch: { type: 'integer', default: 0 },
        emotion: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        sample_rate: { type: 'integer', default: 32000 },
        bitrate: { type: 'integer', default: 128000 },
        channel: { type: 'integer', default: 1 },
        format: { type: 'string', default: 'mp3' },
        language_boost: { type: 'string', default: 'auto' },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['text'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'text_to_image',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    aliases: ['generate_image'],
    description:
      'MiniMax文生图/人物参考图生图，按张计费。subject_reference为单人人像公网URL/data URI或本地JPG/PNG(<10MB)。\n' +
      'parameters支持官方高级字段（如style、seed、aigc_watermark），不能覆盖model/response_format/subject_reference。\n' +
      'local模式下载图片，url模式返回24小时链接；部分失败如实报告，recover_job只补交付。\n',
    capability: 'image.generate',
    modelParams: { aspect_ratio: 'aspectRatio', n: 'count', prompt: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'text_to_imageArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        aspect_ratio: { type: 'string' },
        n: { type: 'integer', default: 1 },
        prompt_optimizer: { type: 'boolean', default: false },
        subject_reference: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
    name: 'upload_file',
    native: 'file-upload',
    group: 'node',
    description:
      '上传指定本地绝对路径，返回file_id和mm_file://引用，不生成媒体。\n' +
      'purpose支持video_generation_input（图片<=30MB/视频<=50MB/音频<=15MB，保存7天）、voice_clone和prompt_audio（<=20MB）。\n' +
      'generate_video也可自动上传本地素材。远端媒体请直接传URL，无需本工具下载后重传。\n',
    inputSchema: {
      type: 'object',
      title: 'upload_fileArguments',
      properties: {
        file: { type: 'string' },
        purpose: { type: 'string', default: 'video_generation_input' },
      },
      required: ['file'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'voice_clone',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    aliases: ['clone_voice'],
    description:
      '音色快速复刻，file（本地绝对路径）或已上传file_id二选一；mp3/m4a/wav，10秒–5分钟，<=20MB。\n' +
      'voice_id须8–256字符且字母开头，仅字母数字-_且不能以-_结尾。可选试听text<=1000字符，试听按合成计费。\n',
    capability: 'voice.clone',
    modelParams: { text: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'voice_cloneArguments',
      properties: {
        voice_id: { type: 'string' },
        file: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        file_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        text: { type: 'string', default: '' },
        model: { type: 'string' },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['voice_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'voice_design',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    aliases: ['design_voice'],
    description: '按文字描述设计音色，preview_text为试听文本。生成的音色用于text_to_audio。',
    capability: 'voice.design',
    inputSchema: {
      type: 'object',
      title: 'voice_designArguments',
      properties: {
        prompt: { type: 'string' },
        preview_text: { type: 'string' },
        voice_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt', 'preview_text'],
    },
    outputSchema: okOutput,
  },
]
