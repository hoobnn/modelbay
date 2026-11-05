/**
 * 豆包语音 MCP 工具定义（手写源码）。
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

export const doubaoSpeechTools: ToolSpec[] = [
  {
    name: 'clone_voice',
    description:
      '声音复刻：用一段录音注册或重新训练音色。speaker_id 是控制台已分配的 S_ 音色 ID（用自定义 ID 时传 ' +
      "speaker_id='custom_speaker_id' 并填 custom_speaker_id）。audio_file：本地录音（wav/mp3/ogg/m4a/aac/pcm，10MB 内），\n" +
      '清晰单人、少噪音。text：录音对应文本，服务会比对，差异过大会失败。language：zh（默认）、en、ja、es、de、fr、ko、' +
      'it、ru、pt、pt-br 等。demo_text：试听文本 4–300 字。parameters：官方请求其余字段（如 extra_params、model_type），深度合并。\n' +
      '会消耗训练次数，不自动重试。之后用 get_voice 查训练状态，合成时把 speaker_id 作为 text_to_speech 的 voice；复刻的音色只能用于豆包合成。\n' +
      "录音技巧见 get_speech_usage_examples(product='voice')。\n",
    capability: 'voice.clone',
    inputSchema: {
      type: 'object',
      title: 'clone_voiceArguments',
      properties: {
        speaker_id: { type: 'string' },
        audio_file: { type: 'string' },
        text: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        demo_text: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        custom_speaker_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['speaker_id', 'audio_file'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'close_realtime_session',
    native: 'realtime-close',
    nature: 'mutate',
    group: 'realtime',
    description:
      '优雅关闭实时会话，等待session.closed，释放连接。退出MCP也会清理会话；历史session.id可用于后续官方会话接续。',
    inputSchema: {
      type: 'object',
      title: 'close_realtime_sessionArguments',
      properties: {
        session_id: { type: 'string' },
        timeout: { type: 'number', default: 10, maximum: 60 },
      },
      required: ['session_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'design_voice',
    description:
      '音色设计：用文字描述或一张图片生成新音色。speaker_id 是控制台已分配的音色 ID。preview_text：试听台词，最多 300 字。\n' +
      'description：声音描述，最多 200 字，如「三十岁左右的男声，低沉温和，语速偏慢」；image：本地图片或 URL（10MB 内），' +
      '按画面人物生成声音。两者至少给一个，都给时图片优先。parameters：官方请求其余字段，深度合并。\n' +
      "会消耗训练次数。返回音色和试听信息。声线描述技巧见 get_speech_usage_examples(product='voice')。\n",
    capability: 'voice.design',
    inputSchema: {
      type: 'object',
      title: 'design_voiceArguments',
      properties: {
        speaker_id: { type: 'string' },
        preview_text: { type: 'string' },
        description: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        image: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['speaker_id', 'preview_text'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'generate_audio',
    description:
      'Seed Audio生成对白、唱歌、音效或配乐；只朗读文字用 text_to_speech。可用speaker或最多3段reference_audios；' +
      'reference_image不能同时配音频参考或speaker。参考素材支持本地路径/URL。format=mp3/wav/ogg_opus/pcm；' +
      'ogg_opus仅48000Hz，其他采样率见完整说明。subtitles开启字幕。返回files、duration、subtitle，按服务规则计费。' +
      '未列出的官方字段放parameters。对白与时间戳提示词示例见get_speech_usage_examples；完整参数见get_tool_help。\n',
    capability: 'audio.music',
    modelParams: { prompt: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'generate_audioArguments',
      properties: {
        prompt: { type: 'string' },
        speaker: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        reference_audios: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        reference_image: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        format: { type: 'string', default: 'mp3' },
        sample_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
        speech_rate: { type: 'integer', default: 0 },
        loudness_rate: { type: 'integer', default: 0 },
        pitch_rate: { type: 'integer', default: 0 },
        subtitles: { type: 'boolean', default: false },
        model: { type: 'string' },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
    name: 'generate_podcast',
    native: 'podcast',
    description:
      '生成双人对谈播客。输入四选一：\n' +
      '- text：一篇文章，模型改写成对谈（推荐 12000 字以内，超出会截断）。\n' +
      '- url：网页 / PDF / doc / txt 的公开链接，内容同 text。\n' +
      '- topic：一个话题，模型联网搜索后生成；它只是话题，不能写格式要求。\n' +
      '- dialogue：逐轮脚本直接演绎，如 [{"speaker":"音色ID","text":"本轮台词"}]，每轮最多 300 字、总共 1 万字。\n' +
      'speakers：两个播客音色 ID（按给出的顺序），不传用官方默认。script_only=true 只生成脚本不合成音频（text/url 适用）。\n' +
      'format：mp3（默认）、pcm、aac、ogg_opus。parameters：官方请求里其余字段（如 retry_info 续传、input_info.input_text_max_length），深度合并。\n' +
      'transport默认sse（POST /api/v3/podcast/sse）；websocket仅用于历史接口兼容。\n' +
      'SSE须收到152且code=20000000才成功；363或HTTP200不能视为成功。返回音频路径、完整rounds、usage、' +
      'task_id（首次150的真实session_id，续传仍用原ID）、session_id（本次会话）、last_finished_round_id；断线、轮次失败或服务端取消' +
      '（151，canceled=true）时 files 里的 .partial 只含已完整结束的轮次，可用 parameters.retry_info 显式续传后按序拼接；' +
      "未完成轮次的分片另存 diagnostic_file（字节数 discarded_bytes），仅供排查，不能作为续传输入。SSE的progress_file在150和完整362时保存原请求和可续传边界，MCP取消也保留。按官方播客计费，可能超过 300 秒；须同时提高客户端超时和MCP_TOOL_TIMEOUT_SEC。技巧见 get_speech_usage_examples(product='podcast')。\n",
    inputSchema: {
      type: 'object',
      title: 'generate_podcastArguments',
      properties: {
        text: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        url: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        topic: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        dialogue: {
          anyOf: [
            { type: 'array', items: { type: 'object', additionalProperties: true } },
            { type: 'null' },
          ],
          default: null,
        },
        speakers: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        script_only: { type: 'boolean', default: false },
        format: { type: 'string', default: 'mp3' },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        transport: { type: 'string', default: 'sse' },
      },
    },
    outputSchema: okOutput,
  },
  {
    name: 'get_job',
    description:
      '查异步任务的进度和结果，job_id 或 task_id 二选一。任务还在进行时查询豆包一次（wait 1–90 秒可轮询），\n' +
      '完成即把结果保存到原输出目录；已结束的任务只读本地记录。不会重新提交。\n' +
      '返回 job_state（running/delivered/failed/download_failed）、completed、files、text（识别）、error。\n',
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
    name: 'get_speech_usage_examples',
    description:
      '查询官方示例的归纳、改写的MCP调用参数、使用技巧和来源；纯本地，无鉴权，不调用云服务。\n' +
      'product=audio/tts/voice/podcast/asr/translation/minutes/realtime。\n' +
      'audio支持category=text/reference/timing/multilingual；不传category返回该产品全部示例。\n' +
      '示例包括参考绑定、时间戳卡点、多语种、引用上文、音色设计/复刻、播客四种输入、热词/上下文/说话人分离等。\n' +
      '路径、URL、音色ID和会话ID占位符需替换；示例未经真实云端生成验证。\n',
    inputSchema: {
      type: 'object',
      title: 'get_speech_usage_examplesArguments',
      properties: {
        product: { type: 'string', default: 'audio' },
        category: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
    name: 'get_voice',
    description: '查询复刻 / 设计音色的训练状态、剩余训练次数和试听信息。不计费。',
    inputSchema: {
      type: 'object',
      title: 'get_voiceArguments',
      properties: {
        speaker_id: { type: 'string' },
        custom_speaker_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['speaker_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'interpret_audio',
    native: 'simultaneous-interpretation',
    description:
      '同声传译 2.0，处理本地 16kHz / 16bit / 单声道 WAV 或 PCM 文件。source_language / target_language 如 zh / en。\n' +
      'mode=s2t 只出原文和译文字幕；s2s 另外合成目标语音，output_format=pcm（16kHz）或 ogg_opus（48kHz），voice 指定音色。\n' +
      'hotwords 提高识别率；glossary 固定术语译法，如 {"火山引擎":"Volcengine"}。\n' +
      'parameters：官方 TranslateRequest 其余字段，深度合并，如 {"request":{"enable_source_language_detect":true}}。\n' +
      '返回原文/译文字幕、usage 和本地音频。实时麦克风需客户端采集，本工具只处理文件。按同传服务计费。\n',
    inputSchema: {
      type: 'object',
      title: 'interpret_audioArguments',
      properties: {
        audio: { type: 'string' },
        source_language: { type: 'string' },
        target_language: { type: 'string' },
        mode: { type: 'string', default: 's2t' },
        hotwords: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        glossary: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        voice: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        output_format: { type: 'string', default: 'pcm' },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['audio', 'source_language', 'target_language'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'list_jobs',
    description:
      '列出最近的异步任务（长文本合成 tts_long、录音识别 asr、妙记 minutes），不联网。调用超时没拿到 job_id 时用它找回。',
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
    name: 'list_speech_capabilities',
    description:
      '列出豆包语音产品、工具、未启用的工具组及启用方法、管理 Action、官方链接和接入边界；不联网、不计费。',
    inputSchema: { type: 'object', title: 'list_speech_capabilitiesArguments', properties: {} },
    outputSchema: okOutput,
  },
  {
    name: 'manage_word_table',
    native: 'hotword-table',
    nature: 'mutate',
    group: 'management',
    description:
      '词表管理：创建/更新/查询/删除热词表与替换词表。action与parameters按官方契约；content为词表TXT内容。\n' +
      'auth=api_key 走官方热词表代理接口；auth=aksk 走签名OpenAPI（替换词表仅支持aksk）。不会静默开启计费开关。\n',
    inputSchema: {
      type: 'object',
      title: 'manage_word_tableArguments',
      properties: {
        action: { type: 'string' },
        parameters: { type: 'object', additionalProperties: true },
        content: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        auth: { type: 'string', default: 'api_key' },
      },
      required: ['action', 'parameters'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'open_realtime_session',
    native: 'realtime-open',
    nature: 'realtime',
    group: 'realtime',
    description:
      '打开官方实时会话（legacy 对话 / seed 双工）。session为官方会话配置对象；extension可传官方扩展字段。\n' +
      'mode=legacy或seed。timeout为握手超时秒数。返回session.id与连接信息，后续用send_realtime_event与receive_realtime_events。\n',
    inputSchema: {
      type: 'object',
      title: 'open_realtime_sessionArguments',
      properties: {
        session: { type: 'object', additionalProperties: true },
        extension: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        timeout: { type: 'number', default: 30, maximum: 120 },
        mode: { type: 'string', default: 'legacy' },
      },
      required: ['session'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'receive_realtime_events',
    native: 'realtime-receive',
    nature: 'realtime',
    group: 'realtime',
    description:
      '接收实时会话事件（等待最多timeout秒，<=60秒），返回ASR、回复文本、Function Calling、上下文、usage等。\n' +
      '音频delta会转换为audio_file/chunk_bytes/audio_format/sample_rate，不返回巨大base64。收到工具调用后执行本地工具，再send_realtime_event回传call_id结果。\n' +
      'seed返回playback_state与顶层clear_playback_buffer（取消事件也带此标记）；true时客户端必须立即停播并清空已缓冲音频，队列溢出也保留该信号。ASR事件不切换播放状态。\n',
    inputSchema: {
      type: 'object',
      title: 'receive_realtime_eventsArguments',
      properties: {
        session_id: { type: 'string' },
        max_events: { type: 'integer', default: 100, minimum: 1, maximum: 500 },
        timeout: { type: 'number', default: 10, maximum: 60 },
      },
      required: ['session_id'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'recover_job',
    description:
      '修复交付：结果下载失败或本地文件丢失时重新保存，链接过期则重新查询一次。正常查进度用 get_job。不会重新提交。',
    inputSchema: {
      type: 'object',
      title: 'recover_jobArguments',
      properties: {
        job_id: { type: 'string' },
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
    name: 'send_realtime_event',
    native: 'realtime-send',
    nature: 'realtime',
    group: 'realtime',
    description:
      '向持久实时会话发送官方JSON事件。event须有type：input_audio_buffer.append + audio(base64)，input_audio_buffer.commit强制判停；response.cancel打断进行中的回复（legacy与seed均可）；session.update更新配置。\n' +
      'conversation.item.create/retrieve/delete管理上下文，role=tool+call_id回传Function Calling结果；input_audio_mute.commit/unmute.commit处理静音。\n' +
      'audio_file可传16kHz/mono/int16裸.pcm，自动20ms分包，文件结束后再发送commit。seed的input_image_buffer.append可传image(base64)或image_file。\n',
    inputSchema: {
      type: 'object',
      title: 'send_realtime_eventArguments',
      properties: {
        session_id: { type: 'string' },
        event: { type: 'object', additionalProperties: true },
        audio_file: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        timeout: { type: 'number', default: 30, maximum: 120 },
        image_file: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['session_id', 'event'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'speech_console',
    native: 'console-management',
    nature: 'mutate',
    group: 'management',
    description:
      '控制台OpenAPI：音色、API Key、服务开停、资源包/声音复刻订单、用量、配额、项目标签管理。action和parameters按官方契约；list_speech_capabilities给出支持动作。\n' +
      '需要VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY（IAM AK/SK，区别于语音API Key）。version默认按动作选择。会执行指定动作，包括创建、删除、下单；查询优先使用List/Get/QuotaMonitoring/UsageMonitoring。\n',
    inputSchema: {
      type: 'object',
      title: 'speech_consoleArguments',
      properties: {
        action: { type: 'string' },
        parameters: { type: 'object', additionalProperties: true },
        version: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['action', 'parameters'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'speech_raw_request',
    native: 'raw-request',
    group: 'management',
    description:
      '兜底入口：按官方请求体原样调用，其他工具覆盖不到时才用。端点固定，不接收任意 URL。\n' +
      '- product=tts / asr_flash / audio：HTTP 合成、极速识别、音频生成，request 为官方完整请求体；音频 base64 换成本地文件。\n' +
      '- product=tts_websocket：WebSocket 合成，mode=unidirectional 或 bidirectional（默认，text_chunks 按顺序流式输入）；\n' +
      '  音色列表标注「仅限单向流」的音色用 bidirectional 会在本地拒绝，需改 mode=unidirectional。\n' +
      '- product=asr_stream：一句话 / 实时流式识别本地 16bit 单声道 WAV/PCM，audio 为文件路径，mode=realtime 或 sentence。\n' +
      '- product=asr_websocket：双向流式识别。\n',
    inputSchema: {
      type: 'object',
      title: 'speech_raw_requestArguments',
      properties: {
        product: { type: 'string' },
        request: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        operation: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        query: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        audio: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        mode: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        text_chunks: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        resource_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['product'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'speech_to_text',
    description:
      '用豆包录音文件识别大模型把音频转成文字。返回情绪和语种标签的千问 ASR 用 ali-bailian。\n' +
      '\n- audio：本地绝对路径或 http(s) URL。支持 wav、mp3、ogg（opus）、m4a、aac、amr、spx。\n' +
      '- mode：\n' +
      '  auto（默认）：要 speakers 时用 standard，否则用 flash。\n' +
      '  flash：极速版，同步返回，本地文件或 URL，不超过 100MB、2 小时；一小时音频通常十几秒到一分钟出结果。\n' +
      '  standard：标准版异步，只接受可下载 URL，最大 512MB、5 小时；立即返回 job_id，用 get_job 查结果，\n' +
      '    完成后保存 transcript.txt 和完整 result.json。idle：闲时版，同 standard，更便宜但更慢。\n' +
      '- language：已知语种时指定，如 zh\n',
    capability: 'audio.transcribe',
    inputSchema: {
      type: 'object',
      title: 'speech_to_textArguments',
      properties: {
        audio: { type: 'string' },
        mode: { type: 'string', default: 'auto' },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        hotwords: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        context: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        utterances: { type: 'boolean', default: false },
        speakers: { type: 'boolean', default: false },
        itn: { type: 'boolean', default: true },
        punc: { type: 'boolean', default: true },
        ddc: { type: 'boolean', default: false },
        format: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['audio'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'summarize_meeting',
    native: 'meeting-notes',
    description:
      '豆包语音妙记：会议 / 课程录音或视频的转写，加全文总结、章节、待办、问答提取、翻译。异步：立即返回 job_id，\n' +
      '之后用 get_job 查进度，完成后把各项结果 JSON 下载到本地（官方链接 24 小时有效）。\n' +
      '\n- file_url：可下载的 http(s) 链接。file_type=audio（MP3/WAV/AAC/FLAC/OGG）或 video（MP4/AVI/MKV/MOV/FLV/WMV）。\n' +
      '- language：原始语种 zh_cn 或 en_us。\n' +
      '- summary 全文总结（默认开），chapters 章节总结，todos 章节待办，qa 问答提取，translate_to=zh_cn / en_us 翻译转写文本。\n' +
      '至少开一项；只要转写文字请用 speech_to_text。\n',
    inputSchema: {
      type: 'object',
      title: 'summarize_meetingArguments',
      properties: {
        file_url: { type: 'string' },
        language: { type: 'string', default: 'zh_cn' },
        file_type: { type: 'string', default: 'audio' },
        summary: { type: 'boolean', default: true },
        chapters: { type: 'boolean', default: false },
        todos: { type: 'boolean', default: false },
        qa: { type: 'boolean', default: false },
        translate_to: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        speakers: { type: 'boolean', default: true },
        speaker_count: { type: 'integer', default: 0 },
        hotwords: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          default: null,
        },
        word_timestamps: { type: 'boolean', default: false },
        bundle_billing: { type: 'boolean', default: false },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['file_url'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'text_to_speech',
    description:
      '豆包语音合成（中文音色、方言、字幕、长文本首选；千问音色用 ali-bailian），text为文本，voice为官方音色ID或S_复刻ID；' +
      'instructions控制语气，dialect/language控制方言/语言，pronunciations指定读音。format=mp3或wav；多段字幕必须wav，' +
      'sample_rate为采样率。支持subtitles输出SRT，按段合成，失败保留已完成段。超过5000字自动改走异步长文本（long_text可强制），' +
      '返回job_id后用get_job取结果。SSML、水印等未列出的官方字段放parameters。按字数计费。完整音色与调节范围见get_tool_help。\n',
    capability: 'audio.speech',
    modelParams: { text: 'promptLength' },
    inputSchema: {
      type: 'object',
      title: 'text_to_speechArguments',
      properties: {
        text: { type: 'string' },
        voice: { type: 'string' },
        instructions: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        dialect: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        language: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        speech_rate: { type: 'integer', default: 0 },
        loudness_rate: { type: 'integer', default: 0 },
        pitch: { type: 'integer', default: 0 },
        format: { type: 'string', default: 'mp3' },
        sample_rate: { type: 'integer', default: 24000 },
        subtitles: { type: 'boolean', default: false },
        pronunciations: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        model: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        resource_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        long_text: { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null },
        out_dir: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
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
    name: 'translate_text',
    native: 'translation',
    description:
      'Seed-X 机器翻译。texts 一次 1–16 条，每条最多 1024 tokens（服务端校验），按原顺序返回。\n' +
      'target_language 如 en / zh / ja；source_language 不传自动检测。\n' +
      'glossary 指定术语译法，如 {"火山引擎":"Volcengine"}，优先于术语表；glossary_table_id 使用控制台建好的术语表。\n' +
      'parameters：官方请求体其余字段，深度合并。返回 translation_list、检测到的语种、token 用量。按 token 计费。\n',
    inputSchema: {
      type: 'object',
      title: 'translate_textArguments',
      properties: {
        texts: { type: 'array', items: { type: 'string' } },
        target_language: { type: 'string' },
        source_language: { type: 'string', default: '' },
        glossary: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
        glossary_table_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['texts', 'target_language'],
    },
    outputSchema: okOutput,
  },
  {
    name: 'upgrade_voice',
    native: 'voice-upgrade',
    nature: 'mutate',
    group: 'management',
    description:
      '把已有复刻音色升级到新版模型（不可撤回）。parameters：官方升级参数，深度合并。之后用 get_voice 查状态。',
    inputSchema: {
      type: 'object',
      title: 'upgrade_voiceArguments',
      properties: {
        speaker_id: { type: 'string' },
        custom_speaker_id: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        parameters: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
          default: null,
        },
      },
      required: ['speaker_id'],
    },
    outputSchema: okOutput,
  },
]
