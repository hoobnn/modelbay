/**
 * 千问非实时语音识别（HTTP）。协议由声明里渠道的 endpoint 决定：
 * - `/compatible-mode/v1/chat/completions`：Qwen3-ASR-Flash（OpenAI 兼容，asr_options）；
 * - `/api/v1/services/aigc/multimodal-generation/generation`：Qwen-Audio-ASR 3.1（DashScope 原生，
 *   parameters.format 必填，上下文写成音频前面的 input_text 消息）；
 * - `/api/v1/services/audio/asr/transcription`：文件转写（异步任务），走 native `asr-filetrans`。
 */
import { ProviderError, selectDefaultModel, toBase64, type AssetRef } from '@modelbay/core'
import type { AdapterContext, ModelDeclaration } from '@modelbay/core'
import { asJson, arr, readAsset, requestJson, type Json } from './http'

export const ASR_PATH = '/compatible-mode/v1/chat/completions'
export const ASR_NATIVE_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
export const FILETRANS_PATH = '/api/v1/services/audio/asr/transcription'

/** 同步识别的协议：chat 走 OpenAI 兼容接口，native 走 DashScope 多模态生成接口。 */
export type AsrProtocol = 'chat' | 'native'

const ASR_ENDPOINTS: Record<string, AsrProtocol> = {
  [ASR_PATH]: 'chat',
  [ASR_NATIVE_PATH]: 'native',
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'mpeg',
  wav: 'wav',
  m4a: 'mp4',
  aac: 'aac',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  amr: 'amr',
  webm: 'webm',
}

export interface AsrOptions {
  /** Public URL, `data:` URI, `oss://` address, or an AssetRef resolved via `ctx.assets`. */
  audio: string | AssetRef
  model?: string
  context?: string
  language?: string
  itn?: boolean
  /** Extra official top-level fields (cannot override model/messages/stream). */
  parameters?: Json
}

export interface AsrRequest {
  path: string
  body: Json
}

/** 该平台支持的 ASR 模型与默认模型，都从声明读。 */
export interface AsrModels {
  /** 同步识别可用的模型 ID（声明了已知 endpoint 的 audio.transcribe 模型） */
  allowed: string[]
  /** 模型 ID → 协议 */
  protocols: Record<string, AsrProtocol>
  /** 走文件转写（异步任务）的模型 ID */
  filetrans: string[]
  /** 默认模型 */
  default: string
}

export function asrModels(declarations: readonly ModelDeclaration[]): AsrModels {
  const protocols: Record<string, AsrProtocol> = {}
  const filetrans: string[] = []
  for (const declaration of declarations) {
    if (!declaration.capabilities.includes('audio.transcribe')) continue
    const channel = declaration.channels.find((entry) => entry.channel === 'bailian')
    const id = channel?.id ?? declaration.id
    const endpoint = channel?.endpoint ?? ''
    if (endpoint === FILETRANS_PATH) filetrans.push(id)
    else if (ASR_ENDPOINTS[endpoint]) protocols[id] = ASR_ENDPOINTS[endpoint]
  }
  const allowed = Object.keys(protocols)
  const picked = selectDefaultModel(declarations, 'audio.transcribe', 'bailian')
  const fallback = picked && protocols[picked.channel.id] ? picked.channel.id : allowed[0]
  return { allowed, protocols, filetrans, default: fallback ?? '' }
}

/** Reject retired date-snapshot IDs and protocols that use a different ASR endpoint. */
export function checkAsrModel(model: string, models: AsrModels): string | null {
  if (models.filetrans.includes(model))
    return `${model} 是文件转写模型（异步任务），请用 native 操作 asr-filetrans（MCP 工具 transcribe_file）`
  if (/-\d{4}-\d{2}-\d{2}(?:-[a-z]+)?$/.test(model) && !models.allowed.includes(model))
    return `${model} 是已下线的日期快照，请改用 ${models.default}`
  if (!models.allowed.includes(model)) return `同步识别只支持 ${models.allowed.join('、')}`
  return null
}

/** 3.1 原生接口要求的 parameters.format：从 data URI 的 MIME 或 URL 扩展名推出。 */
export function audioFormat(audioData: string): string | undefined {
  const mime = /^data:audio\/([\w.+-]+)[;,]/i.exec(audioData)?.[1]?.toLowerCase()
  if (mime) {
    const subtype = mime.replace(/^x-/, '')
    return { mpeg: 'mp3', mp4: 'm4a', 'x-m4a': 'm4a', wave: 'wav' }[subtype] ?? subtype
  }
  const path = audioData.split(/[?#]/)[0] ?? ''
  return /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase()
}

/** Build the request body for the model's protocol; `audioData` is already a URL or data URI. */
export function buildAsrRequest(
  opts: AsrOptions,
  audioData: string,
  models: AsrModels,
): AsrRequest {
  const model = opts.model ?? models.default
  const problem = checkAsrModel(model, models)
  if (problem) throw new ProviderError('invalid_input', problem)
  if (models.protocols[model] === 'native') return nativeAsrRequest(model, opts, audioData)
  const messages: Json[] = []
  if (opts.context)
    messages.push({ role: 'system', content: [{ type: 'text', text: opts.context }] })
  messages.push({
    role: 'user',
    content: [{ type: 'input_audio', input_audio: { data: audioData } }],
  })
  const asrOptions: Json = { enable_itn: opts.itn ?? true }
  if (opts.language) asrOptions.language = opts.language
  const body: Json = { model, messages, asr_options: asrOptions }
  const extra = opts.parameters ?? {}
  if (Object.keys(extra).some((key) => ['model', 'messages', 'stream'].includes(key)))
    throw new ProviderError('invalid_input', 'parameters 不能覆盖 model / messages / stream')
  Object.assign(body, extra)
  return { path: ASR_PATH, body }
}

/**
 * Qwen-Audio-ASR 3.1 的原生请求体。来源（2026-11-11 核对）：
 * https://help.aliyun.com/zh/model-studio/qwen-audio-asr-http-api
 * 「format（必选）」「language_hints」「上下文消息…包含 input_audio 的 user 消息必须放在 messages 数组的最后」；
 * 该接口没有 itn 开关（「支持原生文本润色」）。
 */
function nativeAsrRequest(model: string, opts: AsrOptions, audioData: string): AsrRequest {
  if (opts.itn)
    throw new ProviderError('invalid_input', `${model} 没有 itn 开关（模型自带文本润色）`)
  const extra = { ...opts.parameters }
  const format = (typeof extra.format === 'string' && extra.format) || audioFormat(audioData)
  if (!format)
    throw new ProviderError(
      'invalid_input',
      `${model} 需要音频格式：请在 parameters.format 里填写（wav、mp3、opus 等）`,
    )
  const messages: Json[] = []
  if (opts.context)
    messages.push({ role: 'user', content: [{ type: 'input_text', text: opts.context }] })
  messages.push({
    role: 'user',
    content: [{ type: 'input_audio', input_audio: { data: audioData } }],
  })
  const parameters: Json = {
    ...(opts.language ? { language_hints: [opts.language] } : {}),
    ...extra,
    format,
  }
  return { path: ASR_NATIVE_PATH, body: { model, input: { messages }, parameters } }
}

export interface AsrResult {
  text: string
  language?: string
  emotion?: string
  /** 3.1 原生接口返回的句子（带时间戳，开启说话人分离时有 speaker_id）。 */
  sentences?: Json[]
  usage?: Json
}

/**
 * 解析识别结果：OpenAI 兼容接口读 `choices[0].message` 和 `audio_info` 标注；
 * 3.1 原生接口读 `output.text` 与 `output.sentence(s)`（实测 2026-11-11 响应里 output 下还嵌了一层同样的 output）。
 */
export function parseAsrResponse(data: Json): AsrResult {
  if (data.output !== undefined && data.choices === undefined) {
    const output = asJson(data.output)
    const inner = asJson(output.output)
    const text = typeof output.text === 'string' ? output.text : inner.text
    const sentences = arr(output.sentences ?? inner.sentences).length
      ? arr(output.sentences ?? inner.sentences)
      : output.sentence !== undefined || inner.sentence !== undefined
        ? [output.sentence ?? inner.sentence]
        : []
    return {
      text: typeof text === 'string' ? text : '',
      ...(sentences.length ? { sentences: sentences.map(asJson) } : {}),
      ...(data.usage !== undefined ? { usage: asJson(data.usage) } : {}),
    }
  }
  const choice = asJson(arr(data.choices)[0])
  const message = asJson(choice.message)
  const info = arr(message.annotations)
    .map(asJson)
    .find((annotation) => annotation.type === 'audio_info')
  return {
    text: typeof message.content === 'string' ? message.content : '',
    ...(typeof info?.language === 'string' ? { language: info.language } : {}),
    ...(typeof info?.emotion === 'string' ? { emotion: info.emotion } : {}),
    ...(data.usage !== undefined ? { usage: asJson(data.usage) } : {}),
  }
}

function isRemote(src: string): boolean {
  return /^(?:https?:\/\/|oss:\/\/|data:)/.test(src)
}

/** Resolve an audio reference to a URL/data URI using the host-provided asset source. */
export async function resolveAudio(src: string | AssetRef, ctx: AdapterContext): Promise<string> {
  if (typeof src === 'string') {
    if (!src) throw new ProviderError('invalid_input', '识别音频不能为空')
    if (isRemote(src)) return src
    throw new ProviderError('invalid_input', '不支持本地路径，请传 URL、Data URI 或素材引用')
  }
  if (!ctx.files && !ctx.assets)
    throw new ProviderError('invalid_input', '读取素材引用的音频需要宿主提供素材来源')
  // 与其他素材一致：优先宿主的 files.read，回退到 assets.load
  const loaded = await readAsset(ctx, src)
  const mime = (loaded.mime || src.mime || '').toLowerCase()
  const subtype = mime.split('/')[1] ?? ''
  // 既认扩展名式的子类型（audio/mp3），也认标准 MIME 子类型（audio/mpeg、audio/x-wav）
  const standard = subtype.replace(/^x-/, '')
  const encoded =
    AUDIO_MIME[subtype] ?? (Object.values(AUDIO_MIME).includes(standard) ? standard : undefined)
  if (!encoded) throw new ProviderError('invalid_input', `不支持的识别音频格式：${mime}`)
  if (!loaded.data.length) throw new ProviderError('invalid_input', '识别音频为空')
  return `data:audio/${encoded};base64,${toBase64(loaded.data)}`
}

export async function transcribeAudio(
  ctx: AdapterContext,
  opts: AsrOptions,
  models: readonly ModelDeclaration[],
): Promise<AsrResult> {
  const audioData = await resolveAudio(opts.audio, ctx)
  const { path, body } = buildAsrRequest(opts, audioData, asrModels(models))
  const data = await requestJson(ctx, path, body)
  return parseAsrResponse(data)
}

/**
 * 文件转写（qwen-audio-3.1-asr-flash-filetrans）的提交请求。来源（2026-11-11 核对）：
 * https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api
 * 「input.file_urls…单次请求仅支持1个URL」「必须传入 parameters；无需设置参数时传入空对象 {}」，
 * 支持公网 URL 和 oss:// 临时地址；diarization_enabled / speaker_count / language_hints 等写在 parameters。
 */
export interface FiletransOptions {
  fileUrl: string
  model?: string
  language?: string
  diarization?: boolean
  speakerCount?: number
  parameters?: Json
}

export function buildFiletransRequest(opts: FiletransOptions, models: AsrModels): AsrRequest {
  const model = opts.model ?? models.filetrans[0]
  if (!model || !models.filetrans.includes(model))
    throw new ProviderError(
      'invalid_input',
      models.filetrans.length
        ? `文件转写只支持 ${models.filetrans.join('、')}`
        : '当前没有声明文件转写模型',
    )
  if (!/^(?:https?|oss):\/\//i.test(opts.fileUrl))
    throw new ProviderError('invalid_input', '文件转写须提供公网 URL、oss:// 地址或素材引用')
  const extra = { ...opts.parameters }
  if (Object.keys(extra).some((key) => ['model', 'input'].includes(key)))
    throw new ProviderError('invalid_input', 'parameters 不能覆盖 model / input')
  const parameters: Json = {
    ...(opts.language ? { language_hints: [opts.language] } : {}),
    ...(opts.diarization !== undefined ? { diarization_enabled: opts.diarization } : {}),
    ...(opts.speakerCount !== undefined ? { speaker_count: opts.speakerCount } : {}),
    ...extra,
  }
  return { path: FILETRANS_PATH, body: { model, input: { file_urls: [opts.fileUrl] }, parameters } }
}

export interface TranscriptSegment {
  /** 秒 */
  start: number
  /** 秒 */
  end: number
  text: string
  channel?: number
  speaker?: number
}

/** 解析 transcription_url 指向的结果 JSON：transcripts[].text / sentences[]（毫秒）。 */
export function parseTranscription(data: Json): { text: string; segments: TranscriptSegment[] } {
  const transcripts = arr(data.transcripts).map(asJson)
  const segments: TranscriptSegment[] = []
  for (const transcript of transcripts) {
    for (const sentence of arr(transcript.sentences).map(asJson)) {
      if (typeof sentence.text !== 'string') continue
      segments.push({
        start: Number(sentence.begin_time ?? 0) / 1000,
        end: Number(sentence.end_time ?? 0) / 1000,
        text: sentence.text,
        ...(typeof transcript.channel_id === 'number' ? { channel: transcript.channel_id } : {}),
        ...(typeof sentence.speaker_id === 'number' ? { speaker: sentence.speaker_id } : {}),
      })
    }
  }
  const text = transcripts
    .map((transcript) => (typeof transcript.text === 'string' ? transcript.text : ''))
    .filter(Boolean)
    .join('\n')
  return { text, segments }
}
