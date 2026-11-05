/**
 * Bailian voice enrollment (clone / design / list / query), ported from the Python MCP
 * `ali_bailian_mcp/products.py`. Clone, design and list share one HTTP endpoint and one
 * `voice-enrollment` model; there is no WebSocket.
 *
 * 哪些模型能复刻、哪些能设计、能传哪些语种、能不能开音频预处理，
 * 都从 `src/models/` 的声明读，代码里不再维护型号清单。
 */
import { ProviderError, toBase64, selectDefaultModel, type AssetRef } from '@modelbay/core'
import type { AdapterContext, ModelDeclaration } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const CUSTOMIZATION = '/api/v1/services/audio/tts/customization'
export const ENROLLMENT = 'voice-enrollment'

/** 声音复刻/设计的目标模型信息，全部来自声明。 */
export interface VoiceTargets {
  /** 支持声音复刻的模型 ID */
  clone: string[]
  /** 支持声音设计的模型 ID */
  design: string[]
  /** 每个模型 `language_hints` 支持的语种；没有这一项表示该模型不支持 language_hints */
  languages: Record<string, string[]>
  /** 每个模型是否支持 `enable_preprocess` / `max_prompt_audio_length` */
  preprocess: Record<string, boolean>
  /** 复刻与设计的默认目标模型 */
  defaultTarget: string
}

/**
 * 从声明里读出复刻/设计的目标模型清单。
 *
 * - 能不能复刻/设计：声明的 `limits.speech.voiceClone` / `voiceDesign`；
 * - `language_hints` 的语种：`limits.speech.cloneLanguages`；
 * - 音频预处理参数：`limits.speech.clonePreprocess`；
 * - 默认目标模型：core 选出的默认 audio.speech 模型（要支持复刻）。
 */
export function voiceTargets(declarations: readonly ModelDeclaration[]): VoiceTargets {
  const clone: string[] = []
  const design: string[] = []
  const languages: Record<string, string[]> = {}
  const preprocess: Record<string, boolean> = {}
  for (const declaration of declarations) {
    const speech = declaration.limits?.speech
    if (!speech) continue
    const id = declaration.channels[0]?.id ?? declaration.id
    if (speech.voiceClone) {
      clone.push(id)
      preprocess[id] = speech.clonePreprocess === true
      if (speech.cloneLanguages) languages[id] = [...speech.cloneLanguages]
    }
    if (speech.voiceDesign) design.push(id)
  }
  const preferred = selectDefaultModel(declarations, 'audio.speech')
  const defaultTarget =
    preferred && clone.includes(preferred.channel.id) ? preferred.channel.id : (clone[0] ?? '')
  return { clone, design, languages, preprocess, defaultTarget }
}

export const VOICE_KINDS = ['enrollment', 'cosyvoice', 'clone', 'design'] as const
export const CLONE_AUDIO_LIMIT = 10 * 1024 * 1024
export const CLONE_AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}
export const CLONE_DATA_MIME = [
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]

export function checkPrefix(prefix: string): string | null {
  return /^[A-Za-z0-9]{1,10}$/.test(prefix) ? null : 'prefix must be 1-10 alphanumeric characters'
}

export function checkCloneTarget(target: string, targets: VoiceTargets): string | null {
  return targets.clone.includes(target)
    ? null
    : 'target_model must be an HTTP TTS model that supports voice cloning'
}

export function checkDesignTarget(target: string, targets: VoiceTargets): string | null {
  return targets.design.includes(target)
    ? null
    : 'target_model must be an HTTP TTS model that supports voice design'
}

function dataMime(src: string): string | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(src)
  if (!match) return null
  const mime = (match[1] ?? '').toLowerCase()
  const payload = match[2] ?? ''
  if (!CLONE_DATA_MIME.includes(mime)) return null
  if (payload.length > Math.ceil((CLONE_AUDIO_LIMIT + 2) / 3) * 4) return null
  const decoded = Math.floor((payload.length * 3) / 4)
  if (!decoded || decoded > CLONE_AUDIO_LIMIT) return null
  return mime
}

/** Encode the reference audio as a public URL or a validated Base64 Data URI. */
export async function cloneAudio(src: string | AssetRef, ctx: AdapterContext): Promise<string> {
  if (typeof src === 'string') {
    if (!src) throw new ProviderError('invalid_input', 'Reference audio is required')
    if (/^https?:\/\//.test(src)) return src
    if (src.startsWith('oss://'))
      throw new ProviderError('invalid_input', 'voice-enrollment does not accept oss:// addresses')
    if (src.startsWith('data:')) {
      if (!dataMime(src))
        throw new ProviderError(
          'invalid_input',
          'audio must be a valid WAV/MP3/M4A Data URI within 10 MB',
        )
      return src
    }
    throw new ProviderError('invalid_input', 'Pass a public http(s) URL, a Data URI or an AssetRef')
  }
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for AssetRef audio')
  const loaded = await ctx.assets.load(src.assetId)
  const mime = (loaded.mime || src.mime || '').toLowerCase()
  if (!CLONE_DATA_MIME.includes(mime))
    throw new ProviderError('invalid_input', `Unsupported clone audio MIME: ${mime}`)
  if (!loaded.data.length || loaded.data.length > CLONE_AUDIO_LIMIT)
    throw new ProviderError('invalid_input', 'Clone audio must be non-empty and within 10 MB')
  return `data:${mime};base64,${toBase64(loaded.data)}`
}

export interface CloneOptions {
  audio: string | AssetRef
  targetModel?: string
  prefix?: string
  language?: string
  enablePreprocess?: boolean
  maxPromptAudioLength?: number
}

export interface DesignOptions {
  voicePrompt: string
  previewText: string
  targetModel: string
  prefix?: string
  language?: 'zh' | 'en'
  sampleRate?: 16000 | 24000 | 48000
  responseFormat?: 'pcm' | 'wav' | 'mp3'
}

/** Build the enrollment `create_voice` request for voice cloning. */
export function buildCloneRequest(opts: CloneOptions, audio: string, targets: VoiceTargets): Json {
  const target = opts.targetModel ?? targets.defaultTarget
  const prefix = opts.prefix ?? 'custom'
  const targetProblem = checkCloneTarget(target, targets)
  if (targetProblem) throw new ProviderError('invalid_input', targetProblem)
  const prefixProblem = checkPrefix(prefix)
  if (prefixProblem) throw new ProviderError('invalid_input', prefixProblem)
  const allowed = targets.languages[target]
  if (opts.language !== undefined) {
    if (!allowed || !allowed.includes(opts.language))
      throw new ProviderError(
        'invalid_input',
        `${target} does not support language=${opts.language}`,
      )
  }
  if (opts.enablePreprocess !== undefined || opts.maxPromptAudioLength !== undefined) {
    if (!targets.preprocess[target])
      throw new ProviderError(
        'invalid_input',
        `${target} does not support preprocess/length options`,
      )
    if (
      opts.maxPromptAudioLength !== undefined &&
      (opts.maxPromptAudioLength < 3 || opts.maxPromptAudioLength > 30)
    )
      throw new ProviderError('invalid_input', 'max_prompt_audio_length must be 3.0-30.0 seconds')
  }
  const input: Json = {
    action: 'create_voice',
    target_model: target,
    prefix,
    audio,
  }
  if (opts.language) input.language_hints = [opts.language]
  if (opts.enablePreprocess !== undefined) input.enable_preprocess = opts.enablePreprocess
  if (opts.maxPromptAudioLength !== undefined)
    input.max_prompt_audio_length = opts.maxPromptAudioLength
  return { model: ENROLLMENT, input }
}

/** Build the enrollment `create_voice` request for voice design (with preview audio). */
export function buildDesignRequest(opts: DesignOptions, targets: VoiceTargets): Json {
  const prompt = (opts.voicePrompt ?? '').trim()
  const preview = (opts.previewText ?? '').trim()
  if (!prompt || prompt.length > 500 || preview.length < 15 || preview.length > 200)
    throw new ProviderError('invalid_input', 'voice_prompt 1-500 chars, preview_text 15-200 chars')
  const targetProblem = checkDesignTarget(opts.targetModel, targets)
  if (targetProblem) throw new ProviderError('invalid_input', targetProblem)
  const prefix = opts.prefix ?? 'custom'
  const prefixProblem = checkPrefix(prefix)
  if (prefixProblem) throw new ProviderError('invalid_input', prefixProblem)
  if (opts.language && !['zh', 'en'].includes(opts.language))
    throw new ProviderError('invalid_input', 'voice design language must be zh or en')
  const sampleRate = opts.sampleRate ?? 24000
  const responseFormat = opts.responseFormat ?? 'wav'
  if (
    ![16000, 24000, 48000].includes(sampleRate) ||
    !['pcm', 'wav', 'mp3'].includes(responseFormat)
  )
    throw new ProviderError(
      'invalid_input',
      'sample_rate=16000/24000/48000, response_format=pcm/wav/mp3',
    )
  const input: Json = {
    action: 'create_voice',
    target_model: opts.targetModel,
    voice_prompt: prompt,
    preview_text: preview,
    prefix,
  }
  if (opts.language) input.language_hints = [opts.language]
  return {
    model: ENROLLMENT,
    input,
    parameters: { sample_rate: sampleRate, response_format: responseFormat },
  }
}

export interface ListVoicesOptions {
  kind?: (typeof VOICE_KINDS)[number]
  pageIndex?: number
  pageSize?: number
  prefix?: string
}

/** Clone/design/cosyvoice legacy kinds all map to the shared enrollment list. */
export function buildListVoicesRequest(opts: ListVoicesOptions = {}): Json {
  const kind = opts.kind ?? 'enrollment'
  const pageIndex = opts.pageIndex ?? 0
  const pageSize = opts.pageSize ?? 20
  if (
    !(VOICE_KINDS as readonly string[]).includes(kind) ||
    pageIndex < 0 ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new ProviderError('invalid_input', 'kind/page_index/page_size out of range')
  const input: Json = { action: 'list_voice', page_index: pageIndex, page_size: pageSize }
  if (opts.prefix) input.prefix = opts.prefix
  return { model: ENROLLMENT, input }
}

export function buildGetVoiceRequest(
  voiceId: string,
  kind: (typeof VOICE_KINDS)[number] = 'enrollment',
): Json {
  if (!(VOICE_KINDS as readonly string[]).includes(kind) || !voiceId)
    throw new ProviderError('invalid_input', 'A voice ID and a valid kind are required')
  return { model: ENROLLMENT, input: { action: 'query_voice', voice_id: voiceId } }
}

export interface VoiceResult {
  voiceId?: string
  targetModel?: string
  status?: string
  previewUrl?: string
  previewData?: string
  output: Json
  usage?: Json
  requestId?: string
}

/** Normalize an enrollment response; a missing voice ID is not silently retried. */
export function parseVoiceResult(data: Json): VoiceResult {
  const output = asJson(data.output)
  const voice = output.voice_id ?? output.voice
  const preview = asJson(output.preview_audio)
  return {
    ...(typeof voice === 'string' && voice ? { voiceId: voice } : {}),
    ...(typeof output.target_model === 'string' ? { targetModel: output.target_model } : {}),
    ...(typeof output.status === 'string' ? { status: output.status } : {}),
    ...(typeof preview.url === 'string' ? { previewUrl: preview.url } : {}),
    ...(typeof preview.data === 'string' ? { previewData: preview.data } : {}),
    output,
    ...(data.usage !== undefined ? { usage: asJson(data.usage) } : {}),
    ...(typeof data.request_id === 'string' ? { requestId: data.request_id } : {}),
  }
}

export async function cloneVoice(
  ctx: AdapterContext,
  opts: CloneOptions,
  targets: VoiceTargets,
): Promise<VoiceResult> {
  const audio = await cloneAudio(opts.audio, ctx)
  const body = buildCloneRequest(opts, audio, targets)
  const data = await requestJson(ctx, CUSTOMIZATION, body)
  const result = parseVoiceResult(data)
  const target = opts.targetModel ?? targets.defaultTarget
  if (!result.targetModel) result.targetModel = target
  if (!result.voiceId)
    throw new ProviderError(
      'unknown',
      'Clone response has no voice ID; check list_voices before retrying',
    )
  return result
}

export async function designVoice(
  ctx: AdapterContext,
  opts: DesignOptions,
  targets: VoiceTargets,
): Promise<VoiceResult> {
  const body = buildDesignRequest(opts, targets)
  const data = await requestJson(ctx, CUSTOMIZATION, body)
  const result = parseVoiceResult(data)
  if (!result.targetModel) result.targetModel = opts.targetModel
  if (!result.voiceId)
    throw new ProviderError(
      'unknown',
      'Design response has no voice ID; check list_voices before retrying',
    )
  return result
}

export interface ListVoicesResult {
  voices: Json[]
  output: Json
  requestId?: string
  usage?: Json
}

export async function listVoices(
  ctx: AdapterContext,
  opts: ListVoicesOptions = {},
): Promise<ListVoicesResult> {
  const data = await requestJson(ctx, CUSTOMIZATION, buildListVoicesRequest(opts))
  const output = asJson(data.output)
  return {
    voices: arr(output.voice_list).map(asJson),
    output,
    ...(typeof data.request_id === 'string' ? { requestId: data.request_id } : {}),
    ...(data.usage !== undefined ? { usage: asJson(data.usage) } : {}),
  }
}

export async function getVoice(
  ctx: AdapterContext,
  voiceId: string,
  kind: (typeof VOICE_KINDS)[number] = 'enrollment',
): Promise<VoiceResult> {
  const data = await requestJson(ctx, CUSTOMIZATION, buildGetVoiceRequest(voiceId, kind))
  return { ...parseVoiceResult(data), voiceId }
}
