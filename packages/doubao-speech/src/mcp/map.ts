/**
 * 豆包语音 MCP 参数 → native 操作参数的换算（`ToolSpec.mapArguments`）。
 *
 * 字段名对照官方文档，每个映射旁边写明来源与核对日期；文档里查不到的字段不接。
 */
import { ProviderError } from '@modelbay/core'

type Args = Record<string, unknown>

const isObject = (value: unknown): value is Args =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 深度合并：`patch` 覆盖 `base`，对象逐层合并，数组整体替换。 */
export function deepMerge(base: Args, patch: unknown): Args {
  if (!isObject(patch)) return base
  const out: Args = { ...base }
  for (const [key, value] of Object.entries(patch))
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key] as Args, value) : value
  return out
}

const CLONE_EXTENSIONS: Record<string, string> = {
  wav: 'wav',
  mp3: 'mp3',
  ogg: 'ogg',
  m4a: 'm4a',
  aac: 'aac',
  pcm: 'pcm',
}

/**
 * 声音复刻：音频文件交给 `ctx.assets` 读取，格式取自扩展名。
 * 字段沿用适配器 `voice-clone` 的请求体（speaker_id / language / audio / extra_params.demo_text）。
 */
export function mapCloneVoice(args: Args): Args {
  const file = String(args.audio_file ?? '')
  const name = file.split(/[?#]/)[0] ?? ''
  const format = CLONE_EXTENSIONS[(name.split('.').pop() ?? '').toLowerCase()]
  if (!format)
    throw new ProviderError('invalid_input', 'audio_file 扩展名须为 wav、mp3、ogg、m4a、aac 或 pcm')
  return {
    speaker_id: args.speaker_id,
    audio_asset_id: file,
    format,
    ...(args.language === undefined ? {} : { language: args.language }),
    ...(args.demo_text === undefined ? {} : { demo_text: args.demo_text }),
  }
}

/** 音色设计：试听文本 → text，声音描述 → prompt（适配器 `voice-design` 的字段）。 */
export function mapDesignVoice(args: Args): Args {
  return { speaker_id: args.speaker_id, text: args.preview_text, prompt: args.description }
}

/**
 * 播客：四种输入对应官方 action。
 * 来源：https://docs.volcengine.com/docs/6561/1668014（2026-11-06 核对）：
 * action=0 用 input_text / input_info.input_url，action=3 用 nlp_texts，action=4 用 prompt_text；
 * input_info.only_nlp_text 只返回文本轮次；speaker_info.speakers 两个音色；audio_config.format。
 */
export function mapPodcast(args: Args): Args {
  const inputs = ['text', 'url', 'topic', 'dialogue'].filter((key) => args[key] !== undefined)
  if (inputs.length !== 1)
    throw new ProviderError('invalid_input', 'text、url、topic、dialogue 须四选一')
  const body: Args = {}
  if (args.text !== undefined) body.input_text = args.text
  if (args.url !== undefined) body.input_info = { input_url: args.url }
  if (args.topic !== undefined) Object.assign(body, { action: 4, prompt_text: args.topic })
  if (args.dialogue !== undefined) Object.assign(body, { action: 3, nlp_texts: args.dialogue })
  if (args.script_only === true) {
    if (args.dialogue !== undefined || args.topic !== undefined)
      throw new ProviderError('invalid_input', 'script_only 只适用于 text / url')
    body.input_info = { ...(body.input_info as Args | undefined), only_nlp_text: true }
  }
  if (args.speakers !== undefined) body.speaker_info = { speakers: args.speakers }
  if (args.format !== undefined) body.audio_config = { format: args.format }
  return deepMerge(body, args.parameters)
}

/**
 * 机器翻译：texts → text_list；glossary → corpus.glossary_list；glossary_table_id → corpus.glossary_table_id。
 * 来源：https://docs.volcengine.com/docs/doubao-voice/machine-translation-large-model-api-access-documentation（2026-11-06 核对）
 */
export function mapTranslate(args: Args): Args {
  const corpus: Args = {
    ...(args.glossary === undefined ? {} : { glossary_list: args.glossary }),
    ...(args.glossary_table_id === undefined ? {} : { glossary_table_id: args.glossary_table_id }),
  }
  return {
    text_list: args.texts,
    target_language: args.target_language,
    ...(args.source_language ? { source_language: args.source_language } : {}),
    ...(Object.keys(corpus).length ? { corpus } : {}),
  }
}

/**
 * 语音妙记：提交 / 查询。
 * 来源：https://docs.volcengine.com/docs/DoubaoVoice/DoubaoVoiceMinutes-APIAccessDocumentation（2026-11-06 核对）：
 * Input.Offline.{FileURL,FileType}；Params.{AllActivate,SourceLang,AudioTranscriptionEnable,
 * AudioTranscriptionParams.{SpeakerIdentification,NumberOfSpeaker,HotWords(JSON 字符串),NeedWordTimeSeries},
 * TranslationEnable,TranslationParams.TargetLang,InformationExtractionEnabled,
 * InformationExtractionParams.Types(todo_list/question_answer),SummarizationEnabled,
 * SummarizationParams.Types(summary),ChapterEnabled}；至少开一项附加功能。
 */
export function mapMeetingNotes(args: Args): Args {
  if (typeof args.task_id === 'string' && args.task_id)
    return { action: 'query', task_id: args.task_id }
  if (typeof args.file_url !== 'string' || !args.file_url)
    throw new ProviderError('invalid_input', '提交需要 file_url，查询结果需要 task_id')
  const summary = args.summary !== false
  const types = [
    ...(args.todos === true ? ['todo_list'] : []),
    ...(args.qa === true ? ['question_answer'] : []),
  ]
  const chapters = args.chapters === true
  const translate = typeof args.translate_to === 'string' && args.translate_to !== ''
  if (!summary && !chapters && !types.length && !translate)
    throw new ProviderError(
      'invalid_input',
      '至少开启 summary、chapters、todos、qa、translate_to 之一',
    )
  const hotwords = Array.isArray(args.hotwords) ? args.hotwords : []
  const speakerCount = typeof args.speaker_count === 'number' ? args.speaker_count : 0
  return {
    action: 'submit',
    request: {
      Input: {
        Offline: { FileURL: args.file_url, FileType: args.file_type ?? 'audio' },
      },
      Params: {
        AllActivate: args.bundle_billing === true,
        SourceLang: args.language ?? 'zh_cn',
        AudioTranscriptionEnable: true,
        AudioTranscriptionParams: {
          SpeakerIdentification: args.speakers !== false,
          ...(speakerCount > 0 ? { NumberOfSpeaker: speakerCount } : {}),
          ...(hotwords.length
            ? { HotWords: JSON.stringify(hotwords.map((word) => ({ word }))) }
            : {}),
          NeedWordTimeSeries: args.word_timestamps === true,
        },
        TranslationEnable: translate,
        ...(translate ? { TranslationParams: { TargetLang: args.translate_to } } : {}),
        InformationExtractionEnabled: types.length > 0,
        ...(types.length ? { InformationExtractionParams: { Types: types } } : {}),
        SummarizationEnabled: summary,
        ...(summary ? { SummarizationParams: { Types: ['summary'] } } : {}),
        ChapterEnabled: chapters,
      },
    },
  }
}

/** 词表管理：action / parameters / content 原样交给 hotword-table。 */
export function mapWordTable(args: Args): Args {
  return {
    action: args.action,
    parameters: args.parameters,
    ...(args.content === undefined ? {} : { content: args.content }),
  }
}

/** 兜底请求：流式识别原样透传；`http` 走 POST（request 为请求体，resource_id 为资源 ID）。 */
export function mapRawRequest(args: Args): Args {
  if (args.product === 'http') {
    return {
      path: args.path,
      body: args.request ?? {},
      ...(args.resource_id ? { resource: args.resource_id } : {}),
    }
  }
  return { ...args }
}
