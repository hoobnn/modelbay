/**
 * Qwen-Audio-TTS / CosyVoice / Qwen3-TTS / MiniMax 语音合成。所有调用都走 `ctx.fetch`，没有 WebSocket。
 *
 * 模型数据一律从 `src/models/` 的声明读：
 * - 用哪个接口（协议）由声明里的渠道 endpoint 与 protocol 决定；
 * - 支持不支持自然语言指令、指令能写多长、能复刻/设计哪些语种，都写在声明的 limits 里；
 * - 「谁是默认模型」「默认音色是什么」也在声明里，代码不维护型号清单。
 */
import {
  ProviderError,
  redact,
  selectDefaultModel,
  type ProviderOutput,
  type ProviderUsage,
} from '@modelbay/core'
import type { AdapterContext, ModelDeclaration } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const SYNTH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'
export const QWEN_TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation'

/**
 * 声明里的模型 ID → 该模型的协议。
 *
 * - `synthesizer`：SpeechSynthesizer 接口，请求体走 `input`；
 * - `multimodal`：多模态生成接口，请求体走 `input` + 顶层 `parameters`；
 * - `minimax`：同一条多模态生成接口，但请求体用 `input.voice_setting`，返回的音频是 hex。
 */
export type TtsProtocol = 'synthesizer' | 'multimodal' | 'minimax'

/** 一个 TTS 模型的声明视图：协议、别名、指令支持、默认音色。 */
export interface TtsModel {
  id: string
  protocol: TtsProtocol
  /** 声明里写的接口路径，请求时原样使用。 */
  endpoint: string
  /** 是否支持自然语言指令（instruction）。 */
  instruction: boolean
  /** 指令的字符上限（汉字按 2 计）；不声明表示不限。 */
  instructionMaxLength?: number
  /** 是否支持 `language=other`（官方只对部分模型开放）。 */
  otherLanguage: boolean
  /** 不指定音色时使用的系统音色。 */
  defaultVoice?: string
  /** 官方别名与简称，如 `audio-plus`。 */
  aliases: string[]
  /** 声明本身，供上层查生命周期与默认模型。 */
  declaration: ModelDeclaration
}

const TTS_ENDPOINTS: Record<string, TtsProtocol> = {
  [SYNTH_PATH]: 'synthesizer',
  [QWEN_TTS_PATH]: 'multimodal',
}

/** 声明里 `protocol` 字段的可选值（core 只当字符串承载，取值由百炼解释）。 */
const TTS_PROTOCOLS = new Set<TtsProtocol>(['synthesizer', 'multimodal', 'minimax'])

/**
 * 这个渠道用哪种协议：声明里写了 `protocol` 就用它，否则按接口路径判断。
 *
 * MiniMax 与 CosyVoice / Qwen3-TTS 走同一条多模态生成接口，请求体形状不同，
 * 所以要靠声明里的 `protocol` 区分。
 */
function protocolFor(endpoint: string | undefined, declared: string | undefined) {
  if (declared && TTS_PROTOCOLS.has(declared as TtsProtocol)) return declared as TtsProtocol
  return endpoint ? TTS_ENDPOINTS[endpoint] : undefined
}

/**
 * 读出全部 TTS 模型（能力为 audio.speech，且声明了本适配器支持的接口）。
 *
 * 判定依据是声明里的渠道 endpoint：适配器只说这两种协议，
 * 没声明 endpoint 的旧模型（如已下线的 qwen3-tts-instruct-flash）不进这个清单。
 */
export function ttsModels(declarations: readonly ModelDeclaration[]): TtsModel[] {
  return declarations
    .filter((declaration) => declaration.capabilities.includes('audio.speech'))
    .map((declaration) => {
      const channel = declaration.channels.find((item) => item.channel === 'bailian')
      const endpoint = channel?.endpoint
      const protocol = protocolFor(endpoint, channel?.protocol)
      if (!protocol || !endpoint) return null
      const speech = declaration.limits?.speech
      return {
        id: channel?.id ?? declaration.id,
        protocol,
        endpoint,
        instruction: declaration.limits?.instruction !== false,
        ...(speech?.instructionMaxLength !== undefined
          ? { instructionMaxLength: speech.instructionMaxLength }
          : {}),
        otherLanguage: speech?.otherLanguage === true,
        ...(speech?.defaultVoice ? { defaultVoice: speech.defaultVoice } : {}),
        aliases: [...(declaration.aliases.official ?? []), ...(declaration.aliases.short ?? [])],
        declaration,
      }
    })
    .filter((model): model is TtsModel => model !== null)
}

/** 走 SpeechSynthesizer 协议的模型 ID 集合。 */
export function synthModelIds(models: readonly TtsModel[]): string[] {
  return models.filter((model) => model.protocol === 'synthesizer').map((model) => model.id)
}

/** 支持自然语言指令的模型 ID 集合。 */
export function instructionModelIds(models: readonly TtsModel[]): string[] {
  return models.filter((model) => model.instruction).map((model) => model.id)
}

/**
 * 默认模型：由 core 按声明挑（带 `default: true` 的 active 模型优先），
 * 适配器不写死型号。
 */
export function defaultTtsModel(models: readonly TtsModel[]): TtsModel | undefined {
  const picked = selectDefaultModel(
    models.map((model) => model.declaration),
    'audio.speech',
  )
  if (!picked) return undefined
  return models.find((model) => model.id === picked.channel.id)
}

/**
 * 兼容旧调用的回落模型：走 multimodal 协议、且不是默认模型的那个。
 * 旧调用（qwen3 音色、非语种代码的 language、带 parameters）继续用它。
 */
function compatModel(models: readonly TtsModel[]): TtsModel | undefined {
  const fallback = defaultTtsModel(models)
  return models.find((model) => model.protocol === 'multimodal' && model.id !== fallback?.id)
}

export const TTS_CHUNK = 250

/** Split on sentence-ending punctuation; hard-split a sentence longer than `limit`. */
export function splitText(text: string, limit = TTS_CHUNK): string[] {
  const parts: string[] = []
  let buf = ''
  for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) ?? []) {
    let rest = sentence
    while (rest.length > limit) {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
      parts.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }
    if (buf.length + rest.length > limit) {
      parts.push(buf)
      buf = ''
    }
    buf += rest
  }
  if (buf.trim()) parts.push(buf)
  return parts.filter((part) => part.trim())
}

/** Official instruction counting: CJK characters count as 2, everything else as 1. */
export function instructionLength(text: string): number {
  let total = 0
  for (const char of text) total += /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char) ? 2 : 1
  return total
}

/** 语言提示的两种形态：语种代码（zh、en、ja）或官方的 `other`。 */
function isLanguageHint(language: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(language) || language === 'other'
}

/** 一次合成请求里与选模型有关的参数。 */
export interface TtsModelRequest {
  /** 用户填的模型：可以是完整 ID，也可以是声明里的简称。 */
  model?: string
  /** 音色；自定义音色 ID 以 `{target_model}-` 开头，可反推模型。 */
  voice?: string
  language?: string
  /** 平台特有的额外参数；非空说明是旧调用。 */
  parameters?: Json
}

/**
 * 解析要用的 TTS 模型。
 *
 * 显式模型优先；未指定时按自定义音色 ID 前缀（`{target_model}-…`）推断；
 * 音色、parameters 都没传且 language 为空或是语种代码时用声明里的默认模型；
 * 其余情况（qwen3 音色、非代码形式 language、带 parameters）回落到兼容模型。
 */
export function resolveTtsModel(models: readonly TtsModel[], request: TtsModelRequest): string {
  if (request.model) {
    const alias = models.find((model) => model.aliases.includes(request.model as string))
    return alias?.id ?? request.model
  }
  const synthIds = synthModelIds(models).sort((a, b) => b.length - a.length)
  for (const id of synthIds) {
    if (request.voice?.startsWith(`${id}-`)) return id
  }
  const language = request.language
  const languageHint = !language || isLanguageHint(language)
  const hasParameters =
    request.parameters !== undefined && Object.keys(request.parameters).length > 0
  if (!request.voice && !hasParameters && languageHint) {
    return defaultTtsModel(models)?.id ?? ''
  }
  return compatModel(models)?.id ?? ''
}

/**
 * 不指定音色时用哪个系统音色。
 *
 * - 没显式指定模型、且落在默认模型上：用该模型声明的默认音色；
 * - 走 multimodal 协议的模型：用它自己声明的默认音色；
 * - 其余（显式指定了合成模型）不填音色，由调用方自己传。
 */
export function defaultVoiceFor(
  models: readonly TtsModel[],
  modelId: string,
  explicitModel: boolean,
): string | undefined {
  const model = models.find((item) => item.id === modelId)
  if (!model) return undefined
  if (!explicitModel && model.id === defaultTtsModel(models)?.id) return model.defaultVoice
  if (model.protocol !== 'synthesizer') return model.defaultVoice
  return undefined
}

export interface TtsOptions {
  text: string
  model?: string
  voice?: string
  instructions?: string
  language?: string
  /** Extra official `input` (SpeechSynthesizer) or top-level `parameters` fields. */
  parameters?: Json
}

export interface TtsRequest {
  path: string
  body: Json
}

/**
 * MiniMax 的音色参数：扁平的 speed / vol / pitch / emotion 归到 `voice_setting`。
 *
 * 其余参数（audio_setting、language_boost、pronunciation_dict 等）原样留在 `input` 里。
 */
const MINIMAX_VOICE_FIELDS = ['speed', 'vol', 'pitch', 'emotion'] as const

/** MiniMax 的 `voice_setting`：音色 ID 必选，其余按官方范围取值。 */
function minimaxVoiceSetting(opts: TtsOptions): Json {
  const extra: Json = { ...opts.parameters }
  const declared = asJson(extra.voice_setting)
  delete extra.voice_setting
  const voice: Json = { ...declared }
  for (const key of MINIMAX_VOICE_FIELDS) {
    if (extra[key] !== undefined) {
      voice[key] = extra[key]
      delete extra[key]
    }
  }
  const fallback = typeof declared.voice_id === 'string' ? declared.voice_id : ''
  voice.voice_id = opts.voice || fallback
  return voice
}

/** MiniMax 的请求体：`input.voice_setting` + 其余 input 字段，没有顶层 parameters。 */
function minimaxInput(opts: TtsOptions, text: string): Json {
  const extra: Json = { ...opts.parameters }
  delete extra.voice_setting
  for (const key of MINIMAX_VOICE_FIELDS) delete extra[key]
  const input: Json = { text, voice_setting: minimaxVoiceSetting(opts) }
  if (opts.language) input.language_boost = opts.language
  Object.assign(input, extra)
  return input
}

/**
 * 生成一段合成的 `(path, body)`。
 *
 * 接口路径取自声明的渠道 endpoint，请求体形状按该模型声明的协议生成。
 */
export function ttsRequest(
  model: string,
  opts: TtsOptions,
  text: string,
  models: readonly TtsModel[],
): TtsRequest {
  const known = models.find((item) => item.id === model)
  const protocol = known?.protocol ?? 'multimodal'
  if (protocol === 'minimax') {
    return {
      path: known?.endpoint ?? QWEN_TTS_PATH,
      body: { model, input: minimaxInput(opts, text) },
    }
  }
  if (protocol === 'synthesizer') {
    const input: Json = {
      text,
      voice: opts.voice ?? '',
      format: 'wav',
      sample_rate: 24000,
    }
    if (opts.instructions) input.instruction = opts.instructions
    if (opts.language) input.language_hints = [opts.language]
    Object.assign(input, opts.parameters ?? {})
    return { path: known?.endpoint ?? SYNTH_PATH, body: { model, input } }
  }
  const input: Json = { text, voice: opts.voice ?? '' }
  if (opts.language) input.language_type = opts.language
  const body: Json = { model, input }
  if (opts.parameters) body.parameters = { ...opts.parameters }
  return { path: known?.endpoint ?? QWEN_TTS_PATH, body }
}

/** Validate options before submitting; returns a human-readable problem or null. */
export function checkTts(
  model: string,
  opts: TtsOptions,
  models: readonly TtsModel[],
  mode: 'url' | 'local' = 'url',
): string | null {
  const known = models.find((item) => item.id === model)
  if (!known) {
    const supported = models.map((item) => item.id).join('、')
    return `不支持的语音模型 ${model}；可用模型：${supported}`
  }
  if (known.protocol === 'synthesizer') {
    if (!opts.voice) return '该语音模型必须指定系统音色或复刻音色 ID'
    const extra = opts.parameters ?? {}
    const instruction = extra.instruction ?? opts.instructions
    if (instruction) {
      if (typeof instruction !== 'string') return '语气指令须为字符串'
      if (!known.instruction) return `${model} 不支持语气指令`
      const limit = known.instructionMaxLength
      if (limit !== undefined && instructionLength(instruction) > limit) {
        return `${model} 的语气指令不能超过 ${limit} 字符（汉字按 2 计）`
      }
    }
    if (opts.language === 'other') {
      if (!known.otherLanguage) return `language=other 仅适用于 ${model}`
    } else if (opts.language && !/^[a-z]{2,3}$/.test(opts.language))
      return '语言须为 zh、en、ja 这类语言代码'
    if (Object.keys(extra).some((key) => ['text', 'voice', 'model'].includes(key)))
      return 'parameters 不能覆盖 text / voice / model'
    if (mode === 'local' && (extra.format ?? 'wav') !== 'wav')
      return '本地交付按 WAV 拼接分段；其他格式请改用 url 交付'
    return null
  }
  if (known.protocol === 'minimax') {
    // voice_setting.voice_id 是必选项，没有默认音色可替
    if (!opts.voice && !asJson(opts.parameters?.voice_setting).voice_id)
      return '该语音模型必须指定音色 ID（voice_setting.voice_id）'
    if (opts.instructions) return `${model} 不支持 instructions，请用 voice_setting.emotion`
    const extra = opts.parameters ?? {}
    if (Object.keys(extra).some((key) => ['text', 'model', 'voice'].includes(key)))
      return 'parameters 不能覆盖 text / voice / model'
    if (opts.language && !/^(auto|[A-Za-z][A-Za-z, ]*)$/.test(opts.language))
      return 'language 须是 auto 或官方语种名（如 Chinese）'
    return null
  }
  if (opts.instructions) return `${model} 不支持 instructions，请改用音频模型`
  return null
}

export interface TtsResult {
  url: string
  requestId?: string
  usage?: Json
}

/** MiniMax 返回的音频格式 → MIME。 */
const MINIMAX_AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pcm: 'audio/L16',
}

/** 解 hex 编码的音频（不用 Node 的 Buffer，core 的运行时隔离检查也过）。 */
export function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export interface MinimaxTtsResult {
  output: ProviderOutput
  usage?: ProviderUsage
}

/**
 * 解析 MiniMax 的语音合成结果：音频在 `output.data.audio`（hex），规格在 `output.extra_info`。
 *
 * 官方返回的不是链接而是 hex 音频，所以这里直接给字节。
 */
export function parseMinimaxTtsResponse(data: Json): MinimaxTtsResult {
  const output = asJson(data.output)
  const payload = asJson(output.data)
  const extra = asJson(output.extra_info)
  const hex = payload.audio
  if (typeof hex !== 'string' || !/^(?:[a-f\d]{2})+$/i.test(hex))
    throw new ProviderError('unknown', '百炼 MiniMax 语音合成结果缺少音频数据', {
      retryable: false,
    })
  const format = typeof extra.audio_format === 'string' ? extra.audio_format.toLowerCase() : 'mp3'
  const usage: ProviderUsage = {}
  const characters = asJson(data.usage).characters
  if (typeof characters === 'number') usage.characters = characters
  else if (typeof extra.usage_characters === 'number') usage.characters = extra.usage_characters
  // 官方给的 audio_length 是毫秒
  if (typeof extra.audio_length === 'number') usage.seconds = extra.audio_length / 1000
  return {
    output: {
      type: 'file',
      kind: 'audio',
      mime: MINIMAX_AUDIO_MIME[format] ?? 'audio/mpeg',
      data: hexBytes(hex),
      name: `bailian.${format}`,
    },
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  }
}

/** Parse `output.audio.url` from a SpeechSynthesizer / multimodal-generation response. */
export function parseTtsResponse(data: Json): TtsResult {
  const output = asJson(data.output)
  const audio = asJson(output.audio)
  const url = audio.url ?? output.audio
  if (typeof url !== 'string' || !url)
    throw new ProviderError('unknown', '百炼语音合成结果缺少 audio.url')
  return {
    url,
    ...(typeof data.request_id === 'string' ? { requestId: data.request_id } : {}),
    ...(data.usage !== undefined ? { usage: asJson(data.usage) } : {}),
  }
}

/**
 * Synthesize a single chunk (<= 250 characters for URL delivery). Longer text must be
 * split by the caller with `splitText` and submitted chunk-by-chunk: the SDK never
 * auto-retries an ambiguous submission.
 */
export async function synthesizeQwenAudioTts(
  ctx: AdapterContext,
  opts: TtsOptions,
  models: readonly TtsModel[],
): Promise<TtsResult> {
  const model = resolveTtsModel(models, {
    model: opts.model,
    voice: opts.voice,
    language: opts.language,
    parameters: opts.parameters,
  })
  const text = (opts.text ?? '').trim()
  if (!text) throw new ProviderError('invalid_input', '语音文本不能为空')
  const chunks = splitText(text)
  if (chunks.length > 1)
    throw new ProviderError('invalid_input', 'url 交付一次只能合成一段（不超过 250 字符）')
  const voice = opts.voice ?? defaultVoiceFor(models, model, Boolean(opts.model))
  const problem = checkTts(model, { ...opts, text, voice }, models, 'url')
  if (problem) throw new ProviderError('invalid_input', problem)
  const { path, body } = ttsRequest(model, { ...opts, text, voice }, text, models)
  const data = await requestJson(ctx, path, body)
  return parseTtsResponse(data)
}

/**
 * MiniMax 语音合成：走同一条多模态生成接口，请求体用 `input.voice_setting`，
 * 返回的是 hex 音频而不是链接，所以结果直接给字节。
 *
 * 官方允许一次提交一整段文本（上限 10000 字符），不分段。
 */
export async function synthesizeMinimaxTts(
  ctx: AdapterContext,
  opts: TtsOptions,
  models: readonly TtsModel[],
): Promise<MinimaxTtsResult> {
  const model = resolveTtsModel(models, {
    model: opts.model,
    voice: opts.voice,
    language: opts.language,
    parameters: opts.parameters,
  })
  const text = (opts.text ?? '').trim()
  if (!text) throw new ProviderError('invalid_input', '语音文本不能为空')
  const voice = opts.voice ?? defaultVoiceFor(models, model, Boolean(opts.model))
  const problem = checkTts(model, { ...opts, text, voice }, models)
  if (problem) throw new ProviderError('invalid_input', problem)
  const { path, body } = ttsRequest(model, { ...opts, text, voice }, text, models)
  const data = await requestJson(ctx, path, body)
  return parseMinimaxTtsResponse(data)
}

/** Response of `audio.speech` through the legacy multimodal-generation endpoint. */
export function audioFile(data: Json): {
  type: 'file'
  kind: 'audio'
  mime: string
  url: string
  name: string
} {
  const output = asJson(data.output)
  const audio = asJson(output.audio)
  const url = audio.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url))
    throw new ProviderError('unknown', '百炼语音生成结果缺少文件地址')
  const secure = new URL(url)
  secure.protocol = 'https:'
  return { type: 'file', kind: 'audio', mime: 'audio/wav', url: secure.href, name: 'bailian.wav' }
}

/** Extract `{ inputTokens, outputTokens, images, characters, seconds }` from a DashScope response. */
export function parseUsage(data: Json): ProviderUsage {
  const u = asJson(data.usage)
  const out: ProviderUsage = {}
  if (typeof u.input_tokens === 'number') out.inputTokens = u.input_tokens
  else if (typeof u.prompt_tokens === 'number') out.inputTokens = u.prompt_tokens
  if (typeof u.output_tokens === 'number') out.outputTokens = u.output_tokens
  else if (typeof u.completion_tokens === 'number') out.outputTokens = u.completion_tokens
  if (typeof u.image_count === 'number') out.images = u.image_count
  else if (typeof u.output_image_count === 'number') out.images = u.output_image_count
  if (typeof u.characters === 'number') out.characters = u.characters
  if (typeof u.duration === 'number') out.seconds = u.duration
  return out
}

/** Keep only safe, redacted fields from a raw upstream body (for logs / cause). */
export function safeDetail(value: unknown): string {
  return redact(JSON.stringify(value ?? {}).slice(0, 1000))
}

/** Iterate `output.choices[].message.content[]` plain objects. */
export function choiceContents(data: Json): Json[] {
  return arr(asJson(data.output).choices)
    .flatMap((choice) => arr(asJson(asJson(choice).message).content))
    .map(asJson)
}
