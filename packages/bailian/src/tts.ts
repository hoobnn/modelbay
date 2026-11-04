/**
 * Qwen-Audio-TTS / CosyVoice HTTP SpeechSynthesizer, ported from the Python MCP
 * `ali_bailian_mcp/media.py`. All calls go through `ctx.fetch`; there is no WebSocket.
 */
import { ProviderError, redact, type ProviderUsage } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const SYNTH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'
export const QWEN_TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation'

export const TTS_MODELS: Record<string, string> = {
  flash: 'qwen3-tts-flash',
  audio: 'qwen-audio-3.0-tts-flash',
  'audio-plus': 'qwen-audio-3.0-tts-plus',
  cosyvoice: 'cosyvoice-v3.5-plus',
}

export const QWEN_AUDIO_TTS = [
  'qwen-audio-3.1-tts-plus',
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.1-tts-flash',
  'qwen-audio-3.0-tts-flash',
] as const

export const COSYVOICE_TTS = [
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3-flash',
  'cosyvoice-v2',
] as const

export const SYNTH_MODELS: readonly string[] = [...QWEN_AUDIO_TTS, ...COSYVOICE_TTS]

export const INSTRUCTION_MODELS: readonly string[] = [
  ...QWEN_AUDIO_TTS,
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3-flash',
]

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

/** Explicit model wins; otherwise infer from a custom voice ID prefix, else use flash. */
export function resolveTtsModel(model?: string, voice?: string): string {
  if (model) return TTS_MODELS[model] ?? model
  for (const name of [...SYNTH_MODELS].sort((a, b) => b.length - a.length)) {
    if (voice && voice.startsWith(`${name}-`)) return name
  }
  return TTS_MODELS.flash!
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

/** Build the `(path, body)` pair for one TTS chunk, routed by model family. */
export function ttsRequest(model: string, opts: TtsOptions, text: string): TtsRequest {
  if (SYNTH_MODELS.includes(model)) {
    const input: Json = {
      text,
      voice: opts.voice ?? '',
      format: 'wav',
      sample_rate: 24000,
    }
    if (opts.instructions) input.instruction = opts.instructions
    if (opts.language) input.language_hints = [opts.language]
    Object.assign(input, opts.parameters ?? {})
    return { path: SYNTH_PATH, body: { model, input } }
  }
  const input: Json = { text, voice: opts.voice ?? '' }
  if (opts.language) input.language_type = opts.language
  const body: Json = { model, input }
  if (opts.parameters) body.parameters = { ...opts.parameters }
  return { path: QWEN_TTS_PATH, body }
}

/** Validate options before submitting; returns a human-readable problem or null. */
export function checkTts(
  model: string,
  opts: TtsOptions,
  mode: 'url' | 'local' = 'url',
): string | null {
  if (SYNTH_MODELS.includes(model)) {
    if (!opts.voice) return 'SpeechSynthesizer models require a system or custom voice ID'
    const extra = opts.parameters ?? {}
    const instruction = extra.instruction ?? opts.instructions
    if (instruction) {
      if (typeof instruction !== 'string') return 'instruction must be a string'
      if (!INSTRUCTION_MODELS.includes(model)) return `${model} does not support instruction`
      if (
        (COSYVOICE_TTS as readonly string[]).includes(model) &&
        instructionLength(instruction) > 100
      )
        return 'CosyVoice instruction must be at most 100 characters (CJK counts as 2)'
    }
    if (opts.language === 'other') {
      if (model !== 'qwen-audio-3.1-tts-flash')
        return 'language=other only applies to qwen-audio-3.1-tts-flash'
    } else if (opts.language && !/^[a-z]{2,3}$/.test(opts.language))
      return 'language must be a code such as zh, en or ja'
    if (Object.keys(extra).some((key) => ['text', 'voice', 'model'].includes(key)))
      return 'parameters must not override text/voice/model'
    if (mode === 'local' && (extra.format ?? 'wav') !== 'wav')
      return 'local delivery concatenates WAV chunks; use url delivery for other formats'
    return null
  }
  if (!model.startsWith('qwen3-tts-') || model.includes('realtime'))
    return 'Only non-realtime qwen3-tts-flash and the Qwen-Audio-TTS/CosyVoice models are supported'
  if (opts.instructions) return 'qwen3-tts-flash does not support instructions; use an audio model'
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
): Promise<TtsResult> {
  const model = resolveTtsModel(opts.model, opts.voice)
  const text = (opts.text ?? '').trim()
  if (!text) throw new ProviderError('invalid_input', 'TTS text is required')
  const chunks = splitText(text)
  if (chunks.length > 1)
    throw new ProviderError('invalid_input', 'URL delivery accepts one chunk (<= 250 characters)')
  const problem = checkTts(model, { ...opts, text }, 'url')
  if (problem) throw new ProviderError('invalid_input', problem)
  const { path, body } = ttsRequest(model, { ...opts, text }, text)
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
