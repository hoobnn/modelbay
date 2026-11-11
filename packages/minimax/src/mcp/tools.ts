/**
 * MiniMax MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 */
import type { ToolSpec } from '@modelbay/core'

/** 去掉适配器自己渠道的 `minimax:` 前缀（native 路由没有通用的 model 解析） */
const channelModel = (model: unknown): string | undefined =>
  typeof model === 'string' && model ? model.replace(/^minimax:/, '') : undefined

/** 声音样本按扩展名补 MIME；MCP 素材源只给路径时不带元数据，复刻前要校验格式 */
const CLONE_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
}
const sampleMime = (file: string): string | undefined =>
  CLONE_MIME[file.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? '']

export const minimaxTools: ToolSpec[] = [
  {
    name: 'create_h3_context_ir_task',
    native: 'context-ir',
    description:
      '创建 H3-Context-IR 任务（官方 POST /v2/h3_context_ir）：深度理解多模态输入，异步返回结构化增强提示词，不直接生成视频；按Token计费。\n' +
      '纯文本传prompt，多模态传官方content数组（二选一）；content里的素材须是公网URL、mm_file://ID或data URI，不会自动上传本地文件。\n' +
      'parameters仅支持callback_url。只提交并返回task_id，用get_job查询，结果里的增强提示词放在text输出；需要生成视频时把它交给generate_video。\n',
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
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
  },
  {
    name: 'h3_image_context_ir',
    native: 'image-context-ir',
    // POST /v1/h3_image_context_ir（2026-11-11 核对：
    // https://platform.minimax.cn/docs/api-reference/image-generation-h3-context-ir）
    description:
      '单独调用 MiniMax-H3-Image 的 Prompt 增强（官方 POST /v1/h3_image_context_ir），同步返回 revised_prompt，不生成图片；增强成本折算为输入 token 计费，失败不计费。\n' +
      '不传 images 按文生图增强；images 传参考图（公网URL、mm_file://ID、data URI 或本地绝对路径）按图片编辑增强，张数上限同 generate_image 里该模型的参考图上限。仅 MiniMax-H3-Image 支持，Highspeed 不支持。\n' +
      'size（宽x高）与 aspect_ratio / area 二选一，只影响图片编辑增强；比例由增强决定时返回 aspect_ratio。文生图可分两步：把 revised_prompt 交给 generate_image，parameters 设 disable_prompt_enhanced=true 并带上 aspect_ratio；图片编辑始终开启增强，不能关闭，只适合先预览增强结果。\n',
    capability: 'image.generate',
    inputSchema: {
      type: 'object',
      title: 'h3_image_context_irArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        size: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        aspect_ratio: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        // 面积档取值同 generate_image 的 resolution，由实现按声明校验
        area: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'delete_video_task',
    native: 'delete-video-task',
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
  },
  {
    name: 'generate_video',
    description:
      'MiniMax H3 V2 音画视频生成，支持文生、首帧、尾帧、首尾帧和多模态参考。按量计费。\n' +
      '多模态参考须显式给具体ratio。prompt 为必填文本，可与首/尾帧或参考素材参数组合。\n' +
      '素材接受公网URL、mm_file://ID、data URI或本地绝对路径；本地文件自动上传，有效期7天。\n' +
      '首/尾帧各最多1张，与参考素材互斥。具体素材数量、时长、分辨率与文件大小上限见下面的模型清单。\n' +
      'ratio省略时文生为16:9，其余adaptive；首尾帧总是跟随图片比例。parameters只支持callback_url/aigc_watermark。\n' +
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
    description: '列出本MCP已实现能力与官方来源，不联网；不是账号权限/模型在线可用性证明。',
    inputSchema: { type: 'object', title: 'list_capabilitiesArguments', properties: {} },
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
  },
  {
    name: 'list_video_tasks',
    native: 'list-video-tasks',
    nature: 'query',
    group: 'management',
    description:
      '分页查询云端最近7天H3任务，不下载。task_type为generation/h3_context_ir/regeneration；model按官方filter.model过滤（如MiniMax-H3）。\n' +
      'status为queued/running/succeeded/failed/cancelled；本地历史记录用list_jobs。\n',
    inputSchema: {
      type: 'object',
      title: 'list_video_tasksArguments',
      properties: {
        page_num: { type: 'integer', default: 1 },
        page_size: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        status: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        model: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        task_type: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
    },
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
  },
  {
    name: 'music_generation',
    description:
      '生成歌曲或纯音乐，生成计费。人声歌曲须lyrics或lyrics_optimizer=true；纯音乐设is_instrumental=true并填写prompt。\n' +
      '官方2026-08-20公告：付费音乐API仅历史付费用户可继续使用，免费接口已停止。账号可用性以服务端为准。\n' +
      '当前文档指向 MiniMax-Music3 开源模型作为其他使用方式；该开源模型不属于本工具的API model枚举。\n' +
      '输出固定为hex音频，使用默认audio_setting；结果可recover_job补下载。\n',
    capability: 'audio.music',
    // 官方 is_instrumental 默认 false（POST /v1/music_generation，2026-11-06 核对：
    // https://platform.minimax.cn/docs/api-reference/music-generation）；
    // 适配器在字段缺失时按 SDK 习惯当纯音乐，MCP 这里显式补上官方默认值
    mapArguments: (args) => ({ ...args, is_instrumental: args.is_instrumental ?? false }),
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
      },
    },
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
      'content里的素材须是公网URL、mm_file://ID或data URI，不会自动上传本地文件；parameters只支持callback_url/aigc_watermark。返回task_id，后续get_job查询并下载。\n',
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
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
    },
  },
  {
    name: 'text_to_speech',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    description:
      '同步语音合成，按字符计费。voice_id用list_voices获取；speed=0.5–2，vol=(0,10]，pitch=-12–12，format=mp3/wav/flac/pcm。\n' +
      'emotion、language_boost按官方取值；采样率/码率/声道/格式写入audio_setting。不支持stream；结果可recover_job补下载。\n',
    capability: 'audio.speech',
    modelParams: { speed: 'speed', text: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'text_to_speechArguments',
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
      },
      required: ['text'],
    },
  },
  {
    name: 'generate_image',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    description:
      'MiniMax文生图/参考图生图，按张计费。\n' +
      'image-01系列：subject_reference为单人人像公网URL/data URI或本地JPG/PNG(<10MB)；parameters只支持seed、aigc_watermark和style（{style_type, style_weight}，仅image-01-live生效，style_type为漫画/元气/中世纪/水彩）。\n' +
      'MiniMax-H3-Image系列：images传1~16张参考图时走图片编辑，否则文生图；resolution为面积档1K/2K/4K（默认4K）；parameters支持size（宽x高）、output_format、output_compression、disable_prompt_enhanced（仅文生图）、aigc_watermark。\n' +
      'local模式下载图片，url模式返回24小时链接；部分失败如实报告，recover_job只补交付。\n',
    capability: 'image.generate',
    // subject_reference 是单张人像：换成通用的 images，由 MCP 素材源读取后进适配器的人物参考
    // （POST /v1/image_generation，type=character，JPG/PNG <10MB，2026-11-06 核对：
    // https://platform.minimax.cn/docs/api-reference/image-generation-i2i）
    // H3-Image 的多张参考图直接用 images
    mapArguments: ({ subject_reference, images, ...args }) => ({
      ...args,
      ...(Array.isArray(images) && images.length
        ? { images }
        : typeof subject_reference === 'string' && subject_reference
          ? { images: [subject_reference] }
          : {}),
    }),
    modelParams: {
      aspect_ratio: 'aspectRatio',
      n: 'count',
      prompt: 'promptLength',
      resolution: 'resolution',
    },
    inputSchema: {
      type: 'object',
      title: 'generate_imageArguments',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        aspect_ratio: { type: 'string' },
        n: { type: 'integer', default: 1 },
        prompt_optimizer: { type: 'boolean', default: false },
        subject_reference: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        images: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        resolution: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        output_directory: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'upload_file',
    native: 'upload-file',
    // POST /v1/files/upload（2026-11-06 核对：
    // https://platform.minimax.cn/docs/api-reference/file-management-upload）；
    // 本地路径作为素材 ID 交给 MCP 素材源读取
    mapArguments: ({ file, purpose }) => ({
      asset_id: file,
      ...(typeof purpose === 'string' && purpose ? { purpose } : {}),
    }),
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
  },
  {
    name: 'clone_voice',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    description:
      '音色快速复刻，file（本地绝对路径）或已上传file_id二选一；mp3/m4a/wav，10秒–5分钟，<=20MB。\n' +
      'voice_id须8–256字符且字母开头，仅字母数字-_且不能以-_结尾。可选试听text<=1000字符，试听按合成计费。\n',
    native: 'voice-clone',
    capability: 'voice.clone',
    // POST /v1/voice_clone：file_id 来自 /v1/files/upload（purpose=voice_clone），
    // 试听 text 需要 model（2026-11-06 核对：
    // https://platform.minimax.cn/docs/api-reference/voice-cloning-clone）。
    // 本地路径 / URL 换成素材引用，由适配器先上传再复刻
    // file_id 官方为 integer(int64)（2026-11-06 核对同上），字符串和整数输入都接受，校验在适配器里
    mapArguments: ({ file, file_id, model, ...rest }) => {
      const sample = typeof file === 'string' ? file : ''
      const mime = sample ? sampleMime(sample) : undefined
      const hasFileId =
        typeof file_id === 'number' || (typeof file_id === 'string' && file_id !== '')
      return {
        ...rest,
        ...(channelModel(model) ? { model: channelModel(model) } : {}),
        ...(hasFileId ? { file_id } : {}),
        ...(sample && !hasFileId
          ? { audio: { assetId: sample, kind: 'audio', ...(mime ? { mime } : {}) } }
          : {}),
      }
    },
    modelParams: { text: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'clone_voiceArguments',
      properties: {
        voice_id: { type: 'string' },
        file: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        file_id: {
          anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }],
          default: null,
        },
        text: { type: 'string', default: '' },
        model: { type: 'string' },
      },
      required: ['voice_id'],
    },
  },
  {
    name: 'design_voice',
    // 历史工具名保留兼容，同时注册跨平台统一命名
    description:
      '按文字描述设计音色（POST /v1/voice_design）。prompt<=2000字符，preview_text<=500字符，试听按字符计费；voice_id可选（自定义音色ID，不传则平台自动生成并返回）。生成的音色用于text_to_speech。',
    native: 'voice-design',
    capability: 'voice.design',
    inputSchema: {
      type: 'object',
      title: 'design_voiceArguments',
      properties: {
        prompt: { type: 'string' },
        preview_text: { type: 'string' },
        voice_id: { type: 'string' },
      },
      required: ['prompt', 'preview_text'],
    },
  },
]
