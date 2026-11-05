/**
 * Qwen-Audio-TTS / CosyVoice / Qwen3-TTS 语音合成，移植自 Python MCP
 * `ali_bailian_mcp/media.py`。所有调用都走 `ctx.fetch`，没有 WebSocket。
 *
 * 模型数据一律从 `src/models/` 的声明读：
 * - 用哪个接口（协议）由声明里的渠道 endpoint 决定；
 * - 支持不支持自然语言指令、指令能写多长、能复刻/设计哪些语种，都写在声明的 limits 里；
 * - 「谁是默认模型」「默认音色是什么」也在声明里，代码不维护型号清单。
 */
import { ProviderError, redact, selectDefaultModel, type ProviderUsage } from '@modelbay/core'
import type { AdapterContext, ModelDeclaration } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const SYNTH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'
export const QWEN_TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation'

/** 声明里的模型 ID → 该模型的协议。SpeechSynthesizer 走 input，多模态生成走 parameters。 */
export type TtsProtocol = 'synthesizer' | 'multimodal'

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
      const endpoint = declaration.channels.find(
        (channel) => channel.channel === 'bailian',
      )?.endpoint
      const protocol = endpoint ? TTS_ENDPOINTS[endpoint] : undefined
      if (!protocol || !endpoint) return null
      const speech = declaration.limits?.speech
      return {
        id: declaration.channels[0]?.id ?? declaration.id,
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
 * 解析要用的 TTS 模型（与 hoobnn-mcps 0.8.0 的规则一致）。
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
    return `Unsupported TTS model: ${model}. Supported models: ${supported}`
  }
  if (known.protocol === 'synthesizer') {
    if (!opts.voice) return 'SpeechSynthesizer models require a system or custom voice ID'
    const extra = opts.parameters ?? {}
    const instruction = extra.instruction ?? opts.instructions
    if (instruction) {
      if (typeof instruction !== 'string') return 'instruction must be a string'
      if (!known.instruction) return `${model} does not support instruction`
      const limit = known.instructionMaxLength
      if (limit !== undefined && instructionLength(instruction) > limit) {
        return `${model} instruction must be at most ${limit} characters (CJK counts as 2)`
      }
    }
    if (opts.language === 'other') {
      if (!known.otherLanguage) return `language=other only applies to ${model}`
    } else if (opts.language && !/^[a-z]{2,3}$/.test(opts.language))
      return 'language must be a code such as zh, en or ja'
    if (Object.keys(extra).some((key) => ['text', 'voice', 'model'].includes(key)))
      return 'parameters must not override text/voice/model'
    if (mode === 'local' && (extra.format ?? 'wav') !== 'wav')
      return 'local delivery concatenates WAV chunks; use url delivery for other formats'
    return null
  }
  if (opts.instructions) return `${model} does not support instructions; use an audio model`
  return null
}

export interface TtsResult {
  url: string
  requestId?: string
  usage?: Json
}

/** Parse `output.audio.url` from a SpeechSynthesizer / multimodal-generation response. */
export function parseTtsResponse(data: Json): TtsResult {
  const output = asJson(data.output)
  const audio = asJson(output.audio)
  const url = audio.url ?? output.audio
  if (typeof url !== 'string' || !url)
    throw new ProviderError('unknown', 'Bailian TTS response is missing audio.url')
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
  if (!text) throw new ProviderError('invalid_input', 'TTS text is required')
  const chunks = splitText(text)
  if (chunks.length > 1)
    throw new ProviderError('invalid_input', 'URL delivery accepts one chunk (<= 250 characters)')
  const voice = opts.voice ?? defaultVoiceFor(models, model, Boolean(opts.model))
  const problem = checkTts(model, { ...opts, text, voice }, models, 'url')
  if (problem) throw new ProviderError('invalid_input', problem)
  const { path, body } = ttsRequest(model, { ...opts, text, voice }, text, models)
  const data = await requestJson(ctx, path, body)
  return parseTtsResponse(data)
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
    throw new ProviderError('unknown', 'Bailian generation response is missing a file URL')
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
