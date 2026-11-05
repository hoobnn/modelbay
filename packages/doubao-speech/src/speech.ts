/**
 * Doubao Speech TTS (unidirectional HTTP), including the three symbols reused by
 * `@modelbay/ark`'s Agent Plan TTS: `speechSettings`, `synthesizeSpeech`, `TTS_VOICES`.
 */
import { z } from 'zod'
import {
  fromBase64,
  ProviderError,
  type AdapterContext,
  type CapabilityInput,
  type ProviderOutput,
  type SubmitResult,
  type VoicePreset,
} from '@modelbay/core'
import { asJson, events, failure, incomplete, postRaw, type Json } from './http'

/** Default speech settings. Kept as a zod object so `.shape` / `.parse` stay available. */
export const speechSettings = z.object({
  voice: z.string().min(1).default('zh_female_vv_uranus_bigtts'),
  format: z.enum(['mp3', 'wav']).default('mp3'),
  sampleRate: z.enum(['16000', '24000', '48000']).default('24000'),
  speed: z.number().min(0.5).max(2).default(1),
})
export type SpeechSettings = z.output<typeof speechSettings>

/**
 * Resolve settings: the host's `ctx.settings` (same field names as plein) first, then the
 * original MCP `VOLC_SPEECH_*` secret/env fallback, then the schema defaults.
 * Explicit overrides win.
 */
export function resolveSpeechSettings(
  ctx: AdapterContext,
  overrides: Partial<SpeechSettings> = {},
): SpeechSettings {
  const hosted = ctx.settings ?? {}
  const pick = (name: string, secret: string) => {
    const value = hosted[name]
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
    return ctx.secret(secret)
  }
  const parsed = speechSettings.safeParse({
    voice: overrides.voice ?? pick('voice', 'VOLC_SPEECH_VOICE'),
    format: overrides.format ?? pick('format', 'VOLC_SPEECH_FORMAT'),
    sampleRate: overrides.sampleRate ?? pick('sampleRate', 'VOLC_SPEECH_SAMPLE_RATE'),
    speed: overrides.speed,
  })
  if (!parsed.success)
    throw new ProviderError('invalid_input', `豆包语音设置无效：${parsed.error.issues[0]?.message}`)
  return parsed.data
}

/** Voices suitable for short-drama characters in speech synthesis 2.0. */
export const TTS_VOICES: VoicePreset[] = [
  { id: 'zh_female_vv_uranus_bigtts', title: 'Vivi 2.0', gender: 'female' },
  { id: 'zh_female_xiaohe_uranus_bigtts', title: '小何 2.0', gender: 'female' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', title: '邻家女孩 2.0', gender: 'female' },
  { id: 'zh_female_gaolengyujie_uranus_bigtts', title: '高冷御姐 2.0', gender: 'female' },
  { id: 'zh_female_wenroushunv_uranus_bigtts', title: '温柔淑女 2.0', gender: 'female' },
  {
    id: 'zh_female_zhixingnv_uranus_bigtts',
    title: '知性女声 2.0',
    gender: 'female',
    age: 'mature',
  },
  {
    id: 'zh_female_wenroumama_uranus_bigtts',
    title: '温柔妈妈 2.0',
    gender: 'female',
    age: 'mature',
  },
  { id: 'zh_female_popo_uranus_bigtts', title: '婆婆 2.0', gender: 'female', age: 'mature' },
  { id: 'zh_male_m191_uranus_bigtts', title: '云舟 2.0', gender: 'male' },
  { id: 'zh_male_taocheng_uranus_bigtts', title: '小天 2.0', gender: 'male' },
  { id: 'zh_male_shaonianzixin_uranus_bigtts', title: '少年梓辛 2.0', gender: 'male' },
  { id: 'zh_male_aojiaobazong_uranus_bigtts', title: '傲娇霸总 2.0', gender: 'male' },
  { id: 'zh_male_gaolengchenwen_uranus_bigtts', title: '高冷沉稳 2.0', gender: 'male' },
  { id: 'zh_male_baqiqingshu_uranus_bigtts', title: '霸气青叔 2.0', gender: 'male', age: 'mature' },
  {
    id: 'zh_male_yuanboxiaoshu_uranus_bigtts',
    title: '渊博小叔 2.0',
    gender: 'male',
    age: 'mature',
  },
  {
    id: 'zh_male_xuanyijieshuo_uranus_bigtts',
    title: '悬疑解说 2.0',
    gender: 'male',
    age: 'mature',
  },
]

export function text(value: unknown, name: string, max = 3000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ProviderError('invalid_input', `${name} 必须是 1 至 ${max} 字的文本`)
  return value
}

export function customVoiceId(value: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(value) &&
    !/^((?:S_|ICL_|MIX_|DiT_|BV)|[a-z]{2}_|(?:wvae|moon|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|pluto|umm)_)/i.test(
      value,
    ) &&
    !/_(?:bigtts|bigtts_cc|tob|cs_tob|streaming)$/i.test(value)
  )
}

/** Build the v3 TTS request body. */
export function buildSpeechRequest(
  model: string,
  input: CapabilityInput<'audio.speech'>,
  settings: SpeechSettings,
  plan = false,
): { path: string; resource: string; body: Json } {
  const content = text(input.text, '合成文本')
  const voice = input.voice ?? settings.voice
  if (plan && (voice.startsWith('S_') || customVoiceId(voice)))
    throw new ProviderError('invalid_input', 'Agent Plan 仅支持语音合成 2.0 预置音色')
  const cloned = voice.startsWith('S_') || customVoiceId(voice)
  if (model.startsWith('seed-icl-') && !cloned)
    throw new ProviderError('invalid_input', '声音复刻模型需要已创建的复刻或设计音色 ID')
  const resource = cloned ? (model === 'seed-icl-1.0' ? 'seed-icl-1.0' : 'seed-icl-2.0') : model
  const speed = input.speed ?? settings.speed
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
    throw new ProviderError('invalid_input', '语速须在 0.5 至 2 之间')
  const body: Json = {
    req_params: {
      text: content,
      speaker: text(voice, '音色 ID'),
      audio_params: {
        format: settings.format === 'wav' ? 'pcm' : settings.format,
        sample_rate: Number(settings.sampleRate),
        speech_rate: Math.round((speed - 1) * 100),
      },
      additions: JSON.stringify(input.instruction ? { context_texts: [input.instruction] } : {}),
    },
  }
  return {
    path: plan ? '/api/v3/plan/tts/unidirectional' : '/api/v3/tts/unidirectional',
    resource,
    body,
  }
}

/** Decode concatenated base64 audio chunks from a chunked HTTP response. */
export function decodeAudioStream(
  raw: string,
  field: 'data' | 'audio',
  ctx: AdapterContext,
  settings: SpeechSettings,
  requireEnd = false,
): Uint8Array {
  const chunks: Uint8Array[] = []
  let ended = false
  for (const packet of events(raw)) {
    const code = packet.code
    if (code !== undefined && ![0, 20000000].includes(Number(code)))
      throw failure(200, code, packet.message, ctx)
    if (Number(code) === 20000000) ended = true
    const data = packet[field]
    if (data === undefined || data === null || data === '') continue
    if (
      typeof data !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    )
      throw incomplete('豆包语音返回无效 Base64 音频')
    chunks.push(fromBase64(data))
  }
  if (requireEnd && !ended) throw incomplete('豆包语音未返回合成完成标记')
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  if (!merged.length) throw incomplete('豆包语音未返回内嵌音频')
  return settings.format === 'wav' && requireEnd
    ? pcmWav(merged, Number(settings.sampleRate))
    : merged
}

/** Wrap signed 16-bit little-endian mono PCM in a single RIFF/WAVE container. */
export function pcmWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  if (pcm.length % 2 !== 0) throw incomplete('豆包语音 PCM 音频缺少完整采样')
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) header[offset + i] = value.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeAscii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(header, 0)
  out.set(pcm, 44)
  return out
}

/**
 * Synthesize speech (single submission, not submit/poll). This signature is consumed by
 * `@modelbay/ark` for the Agent Plan `doubao-seed-tts-2.0` model.
 */
export async function synthesizeSpeech(
  model: string,
  input: CapabilityInput<'audio.speech'>,
  ctx: AdapterContext,
  plan = false,
): Promise<SubmitResult> {
  const settings = resolveSpeechSettings(
    ctx,
    input.speed === undefined ? {} : { speed: input.speed },
  )
  const { path, resource, body } = buildSpeechRequest(model, input, settings, plan)
  const response = await postRaw(ctx, path, body, { resource })
  const data = response.decode((raw) => decodeAudioStream(raw, 'data', ctx, settings, true))
  const output: ProviderOutput = {
    type: 'file',
    kind: 'audio',
    mime: settings.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
    name: `doubao.${settings.format}`,
    data,
  }
  return { state: 'succeeded', outputs: [output] }
}

/** Parse a management/creation response body (HTTP 200 may still carry an error code). */
export function parseResponseBody(raw: string, ctx: AdapterContext): Json {
  let body: Json
  try {
    body = asJson(JSON.parse(raw))
  } catch {
    throw incomplete('豆包语音返回无效 JSON 对象')
  }
  const header = isJsonObject(body.header) ? body.header : body
  if (header.code !== undefined && ![0, 20000000].includes(Number(header.code)))
    throw failure(200, header.code, header.message, ctx)
  return isJsonObject(body.data) ? body.data : body
}

function isJsonObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
