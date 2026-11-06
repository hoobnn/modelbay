/**
 * 豆包语音 MCP 工具定义（手写源码）。
 *
 * 这里只写与模型无关的平台特有部分：字段形状、平台开关、参数含义。
 * 与模型有关的部分（可选模型 ID、默认值、时长 / 分辨率 / 画幅等上下限、生命周期提示）
 * 由 `@modelbay/mcp` 在运行时从 `ModelDeclaration` 派生，改声明就跟着变。
 *
 * 每个参数都必须真正落到上游请求：适配器读得到，或由 `mapArguments`（见 ./map.ts）换算。
 * 官方文档里查不到的字段、适配器没实现的能力不在这里出现。
 */
import type { ToolSpec } from '@modelbay/core'
import {
  mapCloneVoice,
  mapDesignVoice,
  mapMeetingNotes,
  mapPodcast,
  mapRawRequest,
  mapTranslate,
  mapWordTable,
} from './map'

const optional = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
  default: null,
})

const string = { type: 'string' }

export const doubaoSpeechTools: ToolSpec[] = [
  {
    name: 'clone_voice',
    native: 'voice-clone',
    mapArguments: mapCloneVoice,
    description:
      '声音复刻：用一段录音训练音色。speaker_id 是控制台已分配的 S_ 音色 ID（不支持自定义音色 ID）。\n' +
      'audio_file：本地录音路径或 URL（wav/mp3/ogg/m4a/aac/pcm，10MB 内），清晰单人、少噪音。\n' +
      'language：zh（默认）或 en。demo_text：试听文本 4–300 字。\n' +
      '会消耗训练次数，不自动重试。之后用 get_voice 查训练状态，合成时把 speaker_id 作为 text_to_speech 的 voice；复刻的音色只能用于豆包合成。\n' +
      "录音技巧见 get_speech_usage_examples(product='voice')。\n",
    inputSchema: {
      type: 'object',
      title: 'clone_voiceArguments',
      properties: {
        speaker_id: string,
        audio_file: string,
        language: optional({ type: 'string', enum: ['zh', 'en'] }),
        demo_text: optional(string),
      },
      required: ['speaker_id', 'audio_file'],
    },
  },
  {
    name: 'design_voice',
    native: 'voice-design',
    mapArguments: mapDesignVoice,
    description:
      '音色设计：用文字描述生成新音色。speaker_id 是控制台已分配的 S_ 音色 ID。\n' +
      'preview_text：试听台词，最多 300 字。description：声音描述，最多 200 字，如「三十岁左右的男声，低沉温和，语速偏慢」。\n' +
      "会消耗训练次数。返回音色和试听信息。声线描述技巧见 get_speech_usage_examples(product='voice')。\n",
    inputSchema: {
      type: 'object',
      title: 'design_voiceArguments',
      properties: {
        speaker_id: string,
        preview_text: string,
        description: string,
      },
      required: ['speaker_id', 'preview_text', 'description'],
    },
  },
  {
    name: 'get_voice',
    native: 'voice-query',
    nature: 'query',
    description:
      '查询复刻 / 设计音色的训练状态和试听信息（speaker_id 为 S_ 音色 ID）。不计费。clone_voice / design_voice 之后用它确认音色是否可用。',
    inputSchema: {
      type: 'object',
      title: 'get_voiceArguments',
      properties: { speaker_id: string },
      required: ['speaker_id'],
    },
  },
  {
    name: 'generate_audio',
    description:
      'Seed Audio 按文字描述生成配乐或音频；只朗读文字用 text_to_speech。\n' +
      'prompt 为音频描述。format=mp3 或 wav；sample_rate 为采样率。按服务规则计费。',
    capability: 'audio.music',
    modelParams: { prompt: 'promptLength', sample_rate: 'sampleRate' },
    inputSchema: {
      type: 'object',
      title: 'generate_audioArguments',
      properties: {
        prompt: string,
        format: { type: 'string', enum: ['mp3', 'wav'], default: 'mp3' },
        sample_rate: { type: 'integer', default: 24000 },
        model: string,
        out_dir: optional(string),
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_podcast',
    native: 'podcast',
    mapArguments: mapPodcast,
    description:
      '生成双人对谈播客。输入四选一：\n' +
      '- text：一篇文章，模型改写成对谈（推荐 12000 字以内）。\n' +
      '- url：网页 / PDF / doc / txt 的公开链接，内容同 text。\n' +
      '- topic：一个话题，模型联网搜索后生成；它只是话题，不能写格式要求。\n' +
      '- dialogue：逐轮脚本直接演绎，如 [{"speaker":"音色ID","text":"本轮台词"}]，每轮最多 300 字、总共 1 万字。\n' +
      'speakers：两个播客音色 ID（按给出的顺序），不传用官方默认。script_only=true 只生成对谈文本不合成音频（仅 text/url）。\n' +
      'format：mp3（默认）、pcm、aac、ogg_opus。parameters：官方请求里其余字段（如 retry_info 续传、use_head_music、' +
      'input_info.input_text_max_length），深度合并，优先于上面的参数。\n' +
      '返回 outputs（完整播客音频的下载链接，或拼好的音频字节）和事件列表（文本轮次等）；给 out_dir 时把音频存到该目录。按官方播客计费，耗时较长。' +
      "技巧见 get_speech_usage_examples(product='podcast')。\n",
    inputSchema: {
      type: 'object',
      title: 'generate_podcastArguments',
      properties: {
        text: optional(string),
        url: optional(string),
        topic: optional(string),
        dialogue: optional({
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        }),
        speakers: optional({ type: 'array', items: string }),
        script_only: { type: 'boolean', default: false },
        format: { type: 'string', enum: ['mp3', 'pcm', 'aac', 'ogg_opus'], default: 'mp3' },
        parameters: optional({ type: 'object', additionalProperties: true }),
        out_dir: optional(string),
      },
    },
  },
  {
    name: 'get_speech_usage_examples',
    description:
      '查询官方示例的归纳、改写的MCP调用参数、使用技巧和来源；纯本地，无鉴权，不调用云服务。\n' +
      'product=audio/tts/voice/podcast/asr/translation/minutes。\n' +
      'audio支持category=text/reference/timing/multilingual；不传category返回该产品全部示例。\n' +
      '路径、URL、音色ID占位符需替换；示例未经真实云端生成验证。\n',
    inputSchema: {
      type: 'object',
      title: 'get_speech_usage_examplesArguments',
      properties: {
        product: { type: 'string', default: 'audio' },
        category: optional(string),
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
    name: 'interpret_audio',
    native: 'simultaneous-interpretation',
    description:
      '同声传译 2.0，处理本地 16kHz / 16bit / 单声道 WAV 或 PCM 文件（本地路径，不读 URL）。source_language / target_language 如 zh / en。\n' +
      'mode=s2t 只出原文和译文字幕；s2s 另外合成目标语音（只返回语音字节数，不保存音频），output_format=pcm（16kHz）或 ogg_opus（48kHz）。\n' +
      'hotwords 提高识别率；glossary 固定术语译法，如 {"火山引擎":"Volcengine"}。\n' +
      '返回原文/译文字幕与 usage。实时麦克风需客户端采集，本工具只处理文件。按同传服务计费。\n',
    inputSchema: {
      type: 'object',
      title: 'interpret_audioArguments',
      properties: {
        audio: string,
        source_language: string,
        target_language: string,
        mode: { type: 'string', enum: ['s2t', 's2s'], default: 's2t' },
        hotwords: optional({ type: 'array', items: string }),
        glossary: optional({ type: 'object', additionalProperties: true }),
        output_format: { type: 'string', enum: ['pcm', 'ogg_opus'], default: 'pcm' },
      },
      required: ['audio', 'source_language', 'target_language'],
    },
  },
  {
    name: 'list_speech_capabilities',
    description:
      '列出豆包语音产品、工具、未启用的工具组及启用方法、管理 Action、官方链接和接入边界；不联网、不计费。',
    inputSchema: { type: 'object', title: 'list_speech_capabilitiesArguments', properties: {} },
  },
  {
    name: 'manage_word_table',
    native: 'hotword-table',
    mapArguments: mapWordTable,
    nature: 'mutate',
    group: 'management',
    description:
      '词表管理（官方热词表代理接口，API Key 鉴权）：创建/更新/查询/删除热词表与替换词表。\n' +
      'action 取 ListBoostingTableLimits、CreateBoostingTable、CheckBoostingTableName、UpdateBoostingTable、' +
      'DeleteBoostingTable、ListBoostingTable、GetBoostingTable 以及对应的 *CorrectTable；' +
      'parameters 为该 Action 的请求体；content 为词表 TXT 内容（写入请求体的 content 字段）。\n',
    inputSchema: {
      type: 'object',
      title: 'manage_word_tableArguments',
      properties: {
        action: string,
        parameters: { type: 'object', additionalProperties: true },
        content: optional(string),
      },
      required: ['action', 'parameters'],
    },
  },
  {
    name: 'speech_console',
    native: 'console-management',
    nature: 'mutate',
    group: 'management',
    description:
      '控制台OpenAPI：音色、API Key、服务开停、资源包/声音复刻订单、用量、配额、项目标签管理。action和parameters按官方契约；list_speech_capabilities给出支持动作。\n' +
      '需要VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY（IAM AK/SK，区别于语音API Key）。version不传时按动作选择，未收录的动作必须给 version。会执行指定动作，包括创建、删除、下单；查询优先使用List/Get/QuotaMonitoring/UsageMonitoring。\n',
    inputSchema: {
      type: 'object',
      title: 'speech_consoleArguments',
      properties: {
        action: string,
        parameters: { type: 'object', additionalProperties: true },
        version: optional(string),
      },
      required: ['action', 'parameters'],
    },
  },
  {
    name: 'speech_raw_request',
    native: 'raw-request',
    mapArguments: mapRawRequest,
    group: 'management',
    description:
      '兜底入口：其他工具覆盖不到时才用。端点固定，不接收任意 URL。\n' +
      '- product=asr_stream：一句话 / 实时流式识别本地 16bit 单声道 WAV/PCM，audio 为文件路径，mode=realtime（默认）或 sentence；\n' +
      '  request 为官方请求体（audio / request 两段合并）；resource_id 覆盖默认资源 ID。\n' +
      '- product=asr_websocket：标准双向流式识别，参数同上。\n' +
      '- product=http：向 path（以 / 开头的官方接口路径）POST request 原文，响应须是单个 JSON 对象；resource_id 为 X-Api-Resource-Id。\n',
    inputSchema: {
      type: 'object',
      title: 'speech_raw_requestArguments',
      properties: {
        product: { type: 'string', enum: ['asr_stream', 'asr_websocket', 'http'] },
        request: optional({ type: 'object', additionalProperties: true }),
        path: optional(string),
        audio: optional(string),
        mode: optional({ type: 'string', enum: ['realtime', 'sentence'] }),
        resource_id: optional(string),
      },
      required: ['product'],
    },
  },
  {
    name: 'speech_to_text',
    description:
      '用豆包录音文件识别大模型（极速版，同步返回）把音频转成文字。返回情绪和语种标签的千问 ASR 用 ali-bailian。\n' +
      '\n- audio：本地绝对路径或 http(s) URL。支持 wav、mp3、ogg（opus）、flac、m4a，大小与时长以模型声明为准。\n' +
      '- language：已知语种时指定，如 zh-CN；不传自动识别。\n' +
      '- itn（文本规整，默认开）、punc（标点，默认开）、ddc（语义顺滑，默认关）。\n' +
      '- utterances：返回分句时间戳（默认开）。\n' +
      '- hotwords：热词列表；context：对话上下文文本；二者只能给一个。\n',
    capability: 'audio.transcribe',
    inputSchema: {
      type: 'object',
      title: 'speech_to_textArguments',
      properties: {
        audio: string,
        language: optional(string),
        hotwords: optional({ type: 'array', items: string }),
        context: optional(string),
        utterances: { type: 'boolean', default: true },
        itn: { type: 'boolean', default: true },
        punc: { type: 'boolean', default: true },
        ddc: { type: 'boolean', default: false },
      },
      required: ['audio'],
    },
  },
  {
    name: 'summarize_meeting',
    native: 'meeting-notes',
    mapArguments: mapMeetingNotes,
    description:
      '豆包语音妙记：会议 / 课程录音或视频的转写，加全文总结、章节、待办、问答提取、翻译。异步：\n' +
      '提交后返回 Data.TaskID；之后再调用本工具只传 task_id 查询，完成后结果里是各项结果 JSON 的下载链接（官方链接有效期有限）。\n' +
      '\n- file_url：可下载的 http(s) 链接，不超过 1GB、2 小时。file_type=audio 或 video。\n' +
      '- language：原始语种 zh_cn 或 en_us。\n' +
      '- summary 全文总结（默认开），chapters 章节，todos 待办提取，qa 问答提取，translate_to=zh_cn / en_us 翻译转写文本。\n' +
      '- speakers 说话人分离（默认开），speaker_count 说话人数（不传自动），hotwords 热词，word_timestamps 词级时间戳，bundle_billing 打包计费。\n' +
      '至少开一项附加功能；只要转写文字请用 speech_to_text。\n',
    inputSchema: {
      type: 'object',
      title: 'summarize_meetingArguments',
      properties: {
        file_url: optional(string),
        task_id: optional(string),
        language: { type: 'string', enum: ['zh_cn', 'en_us'], default: 'zh_cn' },
        file_type: { type: 'string', enum: ['audio', 'video'], default: 'audio' },
        summary: { type: 'boolean', default: true },
        chapters: { type: 'boolean', default: false },
        todos: { type: 'boolean', default: false },
        qa: { type: 'boolean', default: false },
        translate_to: optional({ type: 'string', enum: ['zh_cn', 'en_us'] }),
        speakers: { type: 'boolean', default: true },
        speaker_count: { type: 'integer', minimum: 0 },
        hotwords: optional({ type: 'array', items: string }),
        word_timestamps: { type: 'boolean', default: false },
        bundle_billing: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'text_to_speech',
    description:
      '豆包语音合成（中文音色、方言、长文本首选；千问音色用 ali-bailian），text为文本，voice为官方音色ID或S_复刻ID。\n' +
      'instructions控制语气（仅2.0音色，不计费）；language指定语种（如 zh-cn、en、ja，可选值随音色不同）。\n' +
      'speech_rate / loudness_rate 为官方整数刻度 -50..100（0 为原速 / 原音量，100 为 2 倍）；pitch 为 -12..12 的音调。\n' +
      'format=mp3或wav；sample_rate为采样率。按字数计费。完整音色与调节范围见get_tool_help。\n',
    capability: 'audio.speech',
    modelParams: { text: 'promptLength', sample_rate: 'sampleRate' },
    inputSchema: {
      type: 'object',
      title: 'text_to_speechArguments',
      properties: {
        text: string,
        voice: string,
        instructions: optional(string),
        language: optional(string),
        speech_rate: { type: 'integer', minimum: -50, maximum: 100 },
        loudness_rate: { type: 'integer', minimum: -50, maximum: 100 },
        pitch: { type: 'integer', minimum: -12, maximum: 12 },
        format: { type: 'string', enum: ['mp3', 'wav'], default: 'mp3' },
        sample_rate: { type: 'integer', default: 24000 },
        model: optional(string),
        out_dir: optional(string),
      },
      required: ['text'],
    },
  },
  {
    name: 'translate_text',
    native: 'translation',
    mapArguments: mapTranslate,
    description:
      'Seed-X 机器翻译。texts 一次 1–16 条，每条最多 1024 tokens（服务端校验），按原顺序返回。\n' +
      'target_language 如 en / zh / ja；source_language 不传自动检测。\n' +
      'glossary 指定术语译法，如 {"火山引擎":"Volcengine"}，优先于术语表；glossary_table_id 使用控制台建好的术语表。\n' +
      '返回 translation_list、检测到的语种、token 用量。按 token 计费。\n',
    inputSchema: {
      type: 'object',
      title: 'translate_textArguments',
      properties: {
        texts: { type: 'array', items: string },
        target_language: string,
        source_language: optional(string),
        glossary: optional({ type: 'object', additionalProperties: true }),
        glossary_table_id: optional(string),
      },
      required: ['texts', 'target_language'],
    },
  },
]
