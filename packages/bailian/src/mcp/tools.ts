/**
 * 百炼 MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 */
import type { ToolSpec } from '@modelbay/core'
import {
  mapChatArguments,
  mapCloneArguments,
  mapDesignArguments,
  mapEditVideoArguments,
  mapEmbedArguments,
  mapGenerateAudioArguments,
  mapPortraitArguments,
  mapRerankArguments,
  mapTranscribeArguments,
  mapTranscribeFileArguments,
} from './arguments'

/** 多模态重排序的一项：只含一个 text / image / video 键。 */
const RERANK_ITEM = {
  type: 'object',
  properties: { text: { type: 'string' }, image: { type: 'string' }, video: { type: 'string' } },
  additionalProperties: false,
}

export const bailianTools: ToolSpec[] = [
  {
    name: 'animate_portrait',
    native: 'digital-human-lipsync',
    mapArguments: mapPortraitArguments,
    description:
      '数字人对口型：图片+人声驱动人物口型、表情、动作。image、audio须为公网URL，不上传本地文件。\n' +
      '图片jpg/png/webp等，音频wav/mp3，音频须小于15MB且小于20秒；resolution=480P/720P，默认720P。\n' +
      'parameters合并进官方parameters对象。按输出秒数计费；只提交任务，返回job_id/task_id，之后用get_job查进度。北京地域能力。\n',
    inputSchema: {
      type: 'object',
      title: 'animate_portraitArguments',
      properties: {
        image: { type: 'string' },
        audio: { type: 'string' },
        resolution: { type: 'string' },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['image', 'audio'],
    },
  },
  {
    name: 'chat',
    description:
      '调用百炼语言或视觉模型（千问及 DeepSeek、Kimi、GLM 等第三方）；豆包 Seed 模型用 volcengine-ark 的 chat。' +
      '不确定ID用list_models。history为OpenAI消息列表，不含本轮prompt；images支持本地路径或URL，模型须支持视觉。' +
      'thinking（enable_thinking）/thinking_budget控制思考，max_tokens限制回答，json_mode要求输出JSON，web_search（enable_search）联网计费，部分模型不支持。' +
      '返回content、usage；未列出的官方字段放parameters。完整用法见get_tool_help。\n',
    capability: 'text.chat',
    mapArguments: mapChatArguments,
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
        thinking_budget: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        max_tokens: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        temperature: { anyOf: [{ type: 'number' }, { type: 'null' }], default: null },
        json_mode: { type: 'boolean', default: false },
        web_search: { type: 'boolean', default: false },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'clone_voice',
    description:
      '声音复刻：用 voice-enrollment（action=create_voice）从一段录音创建自定义音色，返回 voice（音色 ID）。创建免费。\n' +
      '- audio：本地文件、公网 http/https URL 或 Base64 Data URI（WAV 16bit/MP3/M4A，≤10MB，≥16kHz，推荐10–20秒、最长60秒，含至少5秒清晰朗读）。\n' +
      '  本地文件编码为Data URI，直接放入官方input.audio，不经过临时上传；oss://未获官方确认，仍拒绝。\n' +
      '- url：旧公网URL别名，不能与audio同时传；内部统一发送input.audio（官方input.url已逐步废弃）。\n' +
      '- target_model：后续合成用的模型；可选范围见下面的模型清单。音色只能用于该模型。\n' +
      '- prefix：音色名前缀，1–10 位字母或数字；音色 ID 形如 {target_model}-{prefix}-{唯一标识}。\n' +
      '- language：样本语种代码（zh、en…，language_hints）。\n' +
      '- enable_preprocess（降噪增强）、max_prompt_audio_length（3–30 秒）：部分模型不支持。\n' +
      '音色需审核：用 get_voice 确认 status=OK 后，再 text_to_speech(voice=音色ID) 合成。响应缺少音色 ID 时不自动重建。\n' +
      '每个账号复刻/设计合计最多1000个音色。使用同地域API Key和workspace根域名；模型列出不代表账号授权。Qwen-Audio-Realtime协议尚未接入。\n',
    native: 'voice-clone',
    mapArguments: mapCloneArguments,
    inputSchema: {
      type: 'object',
      title: 'clone_voiceArguments',
      properties: {
        audio: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        target_model: { type: 'string' },
        prefix: { type: 'string', default: 'custom' },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        enable_preprocess: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        max_prompt_audio_length: { anyOf: [{ type: 'number' }, { type: 'null' }], default: null },
        url: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
    },
  },
  {
    name: 'design_voice',
    description:
      '声音设计：用 voice-enrollment（action=create_voice）按文字描述创建音色，返回 voice（音色 ID）并保存试听音频。创建免费。\n' +
      '- voice_prompt：声音描述，仅中英文，≤500 字符，如「沉稳的中年男性，语速缓慢，音色低沉有磁性」。描述声音特质，不要求模仿真人。\n' +
      '- preview_text：试听文本，15–200 字符，中英文。\n' +
      '- target_model：合成时用的模型；可选范围见下面的模型清单。音色只能用于该模型。\n' +
      '- prefix：1–10 位字母或数字；音色 ID 形如 {target_model}-vd-{prefix}-{唯一标识}。\n' +
      '- language：zh 或 en，须与 preview_text 语种一致。sample_rate=16000/24000/48000，response_format=wav/mp3/pcm。\n' +
      '设计带随机性，可多次生成择优。返回 voiceId、targetModel、previewUrl 或 previewData（试听音频，不落盘）。北京地域能力。\n',
    native: 'voice-design',
    mapArguments: mapDesignArguments,
    inputSchema: {
      type: 'object',
      title: 'design_voiceArguments',
      properties: {
        voice_prompt: { type: 'string' },
        preview_text: { type: 'string' },
        target_model: { type: 'string' },
        prefix: { type: 'string', default: 'custom' },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        sample_rate: { type: 'integer', default: 24000 },
        response_format: { type: 'string', default: 'wav' },
      },
      required: ['voice_prompt', 'preview_text'],
    },
  },
  {
    name: 'embed',
    description:
      '百炼文本/多模态向量化。texts为文本列表；contents用[{"text":"猫"},{"image":"https://example.com/cat.png"}]等官方结构。方舟 Doubao 向量模型用 volcengine-ark 的 embed。\n' +
      '必须且只能选一项。多模态请显式指定对应模型；图片、视频用公网URL或Data URI，不读本地路径。\n' +
      'dimensions设置维度；parameters透传模型支持的参数，如enable_fusion。返回向量、usage。\n' +
      '按输入计费，不自动建索引或知识库。\n',
    capability: 'text.embed',
    native: 'text-embed',
    mapArguments: mapEmbedArguments,
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
      },
    },
  },
  {
    name: 'generate_audio',
    native: 'audio-generation',
    capability: 'audio.speech',
    mapArguments: mapGenerateAudioArguments,
    description:
      '音频生成（qwen-audio-3.1-tts-next）：用自然语言描述整段音频，如多角色对话、播客、带情绪的旁白，同步返回音频。\n' +
      '不是 text_to_speech 的模型：没有 voice 参数，音色写在 prompt 里，或用 references 给最多 3 段参考音频，在 prompt 里以 @voice1–@voice3 引用。\n' +
      '- references：本地路径、公网 URL 或 Data URI；WAV / MP3 / OGG Opus，每段不超过 30 秒、10MB。不支持系统音色与复刻音色 ID。\n' +
      '- format（wav/mp3/pcm）、sample_rate、channels、volume、rate、seed 等的取值与默认值见 get_tool_help；parameters 合并进官方 input 对象。\n' +
      '- out_dir：给了就把音频下载到该目录；不给只返回 24 小时有效链接。\n' +
      '播客场景最长 240 秒，其他场景 120 秒。按 token 计费。\n',
    inputSchema: {
      type: 'object',
      title: 'generate_audioArguments',
      properties: {
        prompt: { type: 'string' },
        references: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        model: { type: 'string' },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
      '百炼生成或编辑图片；中英文字渲染选 qwen，多图融合选 wan，图层拆分/透明背景用 volcengine-ark。' +
      'images为本地路径或URL，size为档位或宽*高，默认不加watermark。返回job_id、job_state、files、artifacts、usage，交付失败可recover_job补下载。' +
      '多张按生成数量计费。未列出的官方字段放parameters。完整参数与限制见get_tool_help。\n',
    capability: 'image.generate',
    modelParams: { size: 'resolution', n: 'count', seed: 'seed' },
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
        size: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        n: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        negative_prompt: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        prompt_extend: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        seed: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        thinking: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        watermark: { type: 'boolean', default: false },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      '生成视频，本地参考视频/音频会自动上传（volcengine-ark 的 Seedance 需公网 URL）。' +
      '支持文生、首帧、首尾帧、图片/视频/音频参考，参考素材与首尾帧互斥。' +
      '素材可用本地路径或URL，本地文件自动上传临时存储。wait默认0只提交，最多90秒轮询。' +
      '返回task_id/job_id，之后用get_job查进度并自动下载。按输出秒数计费。参考数量与完整模型参数见get_tool_help。\n',
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
        prompt_extend: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        seed: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        watermark: { type: 'boolean', default: false },
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
    name: 'edit_video',
    native: 'edit-video',
    capability: 'video.generate',
    mapArguments: mapEditVideoArguments,
    description:
      '视频指令编辑（HappyHorse）：按prompt改风格、替换局部元素；输入1个视频加0–5张参考图，只提交任务，返回job_id/task_id，之后用get_job查进度，完成时取结果。\n' +
      'video须为公网URL，不上传本地文件；reference_images为公网URL或Base64 Data URI。不是generate_video的模型，请求体不同。\n' +
      'resolution、watermark、audio_setting（auto/origin）、seed的取值与默认值见get_tool_help；parameters合并进官方parameters对象。\n',
    inputSchema: {
      type: 'object',
      title: 'edit_videoArguments',
      properties: {
        video: { type: 'string' },
        prompt: { type: 'string' },
        reference_images: { type: 'array', items: { type: 'string' } },
        model: { type: 'string' },
        resolution: { type: 'string' },
        watermark: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        audio_setting: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        seed: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['video', 'prompt'],
    },
  },
  {
    name: 'get_job',
    description:
      '查任务进度和结果，job_id 或 task_id 二选一（都给时须属于同一任务）。\n' +
      '异步任务（generate_video/edit_video/animate_portrait/transcribe_file）还在生成时查询百炼一次（wait 1–90 秒可轮询），\n' +
      '完成即下载到原输出目录；已结束的任务只读本地记录。只给 task_id 且本地没有记录时，新建本地记录再查询。\n' +
      '不会重新提交生成。返回 job_state、completed、files、usage；ok=false 表示查询或交付失败。\n',
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
    name: 'get_voice',
    description:
      '查询自定义音色详情（voice-enrollment query_voice）：status（DEPLOYING 审核中 / OK 可用 / UNDEPLOYED 未通过）、\n' +
      'target_model（合成时必须用的模型）、创建时间等。kind 旧值 clone/design/cosyvoice 等价；max_pages 仅为兼容旧调用保留，不再使用。\n',
    inputSchema: {
      type: 'object',
      title: 'get_voiceArguments',
      properties: {
        voice: { type: 'string' },
        kind: { type: 'string', default: 'enrollment' },
        max_pages: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
      },
      required: ['voice'],
    },
  },
  {
    name: 'list_capabilities',
    description:
      '列出百炼MCP工具和官方来源，不联网，不代表账号权限；各工具已于2026-10-13用北京地域账号做过小样本云端验证。',
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
    name: 'list_models',
    description:
      '查询百炼官方模型目录（包括视频等全模态），按名称过滤，最多max_pages页。\n' +
      '返回模型ID及能力、快照、上下文、价格等官方字段；complete标记是否取完分页。\n' +
      '目录存在不等于当前API Key拥有调用权限，account_verified固定false；权限需单独核实。\n',
    inputSchema: {
      type: 'object',
      title: 'list_modelsArguments',
      properties: {
        keyword: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        max_pages: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'list_voices',
    description:
      '分页查询 voice-enrollment 下的全部自定义音色，复刻和设计音色在同一列表。\n' +
      'kind 旧值 clone/design/cosyvoice 仍可传，均等价于 enrollment（已下线的 Qwen 复刻/设计音色无法再用于合成）。\n' +
      'page_index 从 0 起，page_size=1–100，prefix 按音色名前缀过滤。返回 voice_id、status、创建时间等官方字段。不会创建或删除音色。\n',
    inputSchema: {
      type: 'object',
      title: 'list_voicesArguments',
      properties: {
        kind: { type: 'string', default: 'enrollment' },
        page_index: { type: 'integer', default: 0, minimum: 0 },
        page_size: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        prefix: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
    },
  },
  {
    name: 'recover_job',
    description:
      '修复交付或续做（正常查进度用 get_job）：视频查原task_id；图片/设计音色试听只补下载、不重建音色；TTS跳过已合成分段并继续尚未提交的分段（这些分段仍会计费）。\n' +
      '状态未知的同步请求不自动重试。校验完整文件后跳过；wait=0视频查一次，最多90秒。临时结果过期可能无法恢复。\n',
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
  {
    name: 'rerank',
    native: 'rerank',
    nature: 'query',
    description:
      '对候选文档按与query的相关性排序，返回原索引和relevance_score；top_n控制数量，return_documents返回原文。\n' +
      'query与documents的每一项可以是文本，也可以是只含一个键的对象：{"text":…}、{"image":公网URL或Data URI}、documents里还可以{"video":公网URL}；' +
      '图片、视频只有 qwen3-vl-rerank 支持，不上传本地文件。instruct自定义任务说明（建议英文），fps控制视频抽帧（仅 qwen3-vl-rerank，取值范围见 get_tool_help）。\n' +
      '所有模型统一走原生text-rerank接口。分数用于本次请求内比较。按输入计费，模型及地域权限以服务端为准。\n',
    capability: 'text.embed',
    mapArguments: mapRerankArguments,
    inputSchema: {
      type: 'object',
      title: 'rerankArguments',
      properties: {
        query: { anyOf: [{ type: 'string' }, RERANK_ITEM] },
        documents: { type: 'array', items: { anyOf: [{ type: 'string' }, RERANK_ITEM] } },
        model: { type: 'string' },
        top_n: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        return_documents: { type: 'boolean', default: false },
        instruct: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['query', 'documents'],
    },
  },
  {
    name: 'speech_to_text',
    description:
      '用千问 ASR 把一段音频转成文字（同步返回）。超过 10MB / 5 分钟的录音用 transcribe_file（文件转写，最长 12 小时）。\n' +
      '\n- audio：本地绝对路径或 URL。本地文件支持 mp3、wav、m4a、aac、flac、ogg、opus、amr、webm，不超过 10MB，时长不超过 5 分钟。\n' +
      '- model：qwen3-asr-flash 走 OpenAI 兼容接口，返回语种和情绪；qwen-audio-3.1-asr-flash 走原生接口，返回带时间戳的句子（sentences），' +
      '自带文本润色。可选模型见下面的清单。\n' +
      '- context：背景文字，提高专有名词、人名、术语的识别准确率，如「这是一段关于 Kubernetes 和 Istio 的技术分享」。\n' +
      '- language：已知语种时指定（zh、en、ja、ko、yue 等），能提高准确率；不传自动识别。\n' +
      '- itn：是否把口语数字转成阿拉伯数字（仅 qwen3-asr-flash），默认不转。\n' +
      '- parameters：官方请求体里本工具没单独列出的字段。qwen3-asr-flash 合并到 OpenAI 兼容接口顶层，不能覆盖 model/messages/stream；' +
      'qwen-audio-3.1-asr-flash 合并到官方 parameters（如 format、sample_rate、keep_dialect、speaker_diarization_enabled、vocabulary），' +
      'format 不传时从文件类型推断。\n' +
      '\n按音频时长计费。返回 ok、model、text、language、emotion、sentences、usage、error。\n',
    native: 'asr',
    mapArguments: mapTranscribeArguments,
    inputSchema: {
      type: 'object',
      title: 'speech_to_textArguments',
      properties: {
        audio: { type: 'string' },
        context: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        itn: { type: 'boolean', default: false },
        model: { type: 'string' },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['audio'],
    },
  },
  {
    name: 'text_to_speech',
    description:
      '用百炼非实时 TTS 把文字合成语音，返回音频文件的 24 小时有效链接。按模型名自动选择协议。\n' +
      '中文系统音色、方言、SRT 字幕、超长文本也可用 doubao-speech 的 text_to_speech。\n' +
      '\n- model（别名或完整 ID）：不传用默认模型 qwen-audio-3.1-tts-flash；用复刻/设计生成的自定义音色时，' +
      '须同时传生成该音色的 target_model，音色只能用于该模型。其余情况见下面的模型清单。\n' +
      '- text：要朗读的文字。CosyVoice 与 Qwen-Audio-TTS 一次合成一段，不超过 250 字符，更长的文本需自己分段多次调用；' +
      'qwen3-tts-flash 不超过 600 字符。\n' +
      '- voice：系统音色或自定义音色 ID；各模型可选的系统音色见官方音色列表，不能跨模型混用。' +
      'CosyVoice 与 Qwen-Audio-TTS 必须指定 voice，没有默认音色。\n' +
      '- instructions：语气/情感/方言指令（官方字段 instruction），如「用温柔的语气，语速稍慢」「请讲上海话。」。\n' +
      '  仅 Qwen-Audio-TTS 与 CosyVoice 3 / 3.5 系列（cosyvoice-v3-flash、v3.5-flash、v3.5-plus）支持，' +
      'cosyvoice-v2、cosyvoice-v3-plus 与 qwen3-tts-flash 传了会直接报错；CosyVoice 不超过 100 字符（汉字按 2 计），' +
      'Qwen-Audio-TTS 官方未公布同一上限，交服务端校验。\n' +
      '- language：仅对 qwen3-tts-flash 生效，写 Chinese、English、Japanese 等，不传自动识别；' +
      'CosyVoice / Qwen-Audio-TTS 请把语种代码放进 parameters.language_hints（如 ["zh"]）。\n' +
      '- out_dir：给了就把音频下载到该目录；不给只返回24小时有效链接。\n' +
      '- parameters：合并进官方 input 对象（如 Qwen-Audio-TTS/CosyVoice 的 rate、pitch、volume、seed、hot_fix、language_hints），' +
      '不能覆盖 text/voice/model；不会写入官方顶层 parameters。\n' +
      '\n按字符计费。返回 job_state、files、usage。\n',
    capability: 'audio.speech',
    inputSchema: {
      type: 'object',
      title: 'text_to_speechArguments',
      properties: {
        text: { type: 'string' },
        voice: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        instructions: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        model: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'transcribe_file',
    native: 'asr-filetrans',
    capability: 'audio.transcribe',
    mapArguments: mapTranscribeFileArguments,
    description:
      '录音文件转写（异步任务）：单个文件最长 12 小时、2GB，只提交任务，返回 job_id/task_id，之后用 get_job 查进度，' +
      '完成时返回全文（text）和带时间戳的句子（json.segments，单位秒）。5 分钟以内的短音频用 speech_to_text 更快。\n' +
      '- audio：公网 URL、oss:// 地址或本地路径；本地文件会先上传到百炼临时存储（48 小时有效，不超过 15MB），更大的文件请给公网 URL。\n' +
      '- language：已知语种时指定（zh、en 等），写入 language_hints。\n' +
      '- diarization：说话人分离（只对单声道音频生效），speaker_count 给参考人数（不保证），取值范围见 get_tool_help。\n' +
      '- parameters：合并进官方 parameters 对象（如 keep_dialect、vocabulary、vocabulary_id、channel_id）。\n' +
      '按 token 计费；channel_id 指定多个音轨时每个音轨单独计费。\n',
    inputSchema: {
      type: 'object',
      title: 'transcribe_fileArguments',
      properties: {
        audio: { type: 'string' },
        model: { type: 'string' },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['audio'],
    },
  },
]
