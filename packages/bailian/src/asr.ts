/**
 * Qwen ASR (HTTP, non-streaming), ported from the Python MCP
 * `ali_bailian_mcp/media.py::speech_to_text`. Uses `/compatible-mode/v1/chat/completions`.
 */
import { ProviderError, selectDefaultModel, toBase64, type AssetRef } from '@modelbay/core'
import type { AdapterContext, ModelDeclaration } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const ASR_PATH = '/compatible-mode/v1/chat/completions'

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
  /** 声明里 audio.transcribe 能力的模型 ID */
  allowed: string[]
  /** 默认模型 */
  default: string
}

export function asrModels(declarations: readonly ModelDeclaration[]): AsrModels {
  const scoped = declarations.filter((declaration) =>
    declaration.capabilities.includes('audio.transcribe'),
  )
  const allowed = scoped.map(
    (declaration) =>
      declaration.channels.find((channel) => channel.channel === 'bailian')?.id ?? declaration.id,
  )
  const picked = selectDefaultModel(declarations, 'audio.transcribe', 'bailian')
  return { allowed, default: picked?.channel.id ?? allowed[0] ?? '' }
}

/** Reject retired date-snapshot IDs and protocols that use a different ASR endpoint. */
export function checkAsrModel(model: string, models: AsrModels): string | null {
  if (/-\d{4}-\d{2}-\d{2}(?:-[a-z]+)?$/.test(model) && !models.allowed.includes(model))
    return `${model} 是已下线的日期快照，请改用 ${models.default}`
  if (!models.allowed.includes(model)) return `该 HTTP 识别端点只支持 ${models.allowed.join('、')}`
  return null
}

/** Build the chat/completions body; `data` is already a URL or data URI. */
export function buildAsrRequest(
  opts: AsrOptions,
  audioData: string,
  models: AsrModels,
): AsrRequest {
  const model = opts.model ?? models.default
  const problem = checkAsrModel(model, models)
  if (problem) throw new ProviderError('invalid_input', problem)
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

export interface AsrResult {
  text: string
  language?: string
  emotion?: string
  usage?: Json
}

/** Parse `choices[0].message` plus the `audio_info` annotation. */
export function parseAsrResponse(data: Json): AsrResult {
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
  if (!ctx.assets)
    throw new ProviderError('invalid_input', '读取素材引用的音频需要宿主提供素材来源')
  const loaded = await ctx.assets.load(src.assetId)
  const mime = (loaded.mime || src.mime || '').toLowerCase()
  const subtype = mime.split('/')[1] ?? ''
  const encoded = AUDIO_MIME[subtype]
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
