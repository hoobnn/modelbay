/**
 * 豆包同声传译（simultaneous interpretation）的请求计划。
 *
 * 官方协议是 WSS + protobuf（`TranslateRequest` / `TranslateResponse`），
 * `AdapterContext.fetch` 只能发 HTTP 请求，带不动二进制帧，所以这里不联网：
 * 按官方协议把请求体、事件号、连接头与音频分片规则算好交给宿主，
 * 由宿主注入 WebSocket 与 protobuf 编解码器。
 *
 * 来源：https://docs.volcengine.com/docs/doubao-voice/simultaneous-interpretation2-0-api-access-documentation
 */
import { ProviderError } from '@modelbay/core'
import { asJson, isJson, type Json } from './http'

/** 同传接口地址。 */
export const INTERPRETATION_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate'
/** 同传的资源 ID。 */
export const INTERPRETATION_RESOURCE_ID = 'volc.service_type.10053'
/** 音频分片大小：80ms、16000Hz、16bit、单声道 = 2560 字节。 */
export const INTERPRETATION_CHUNK_BYTES = 2560

/**
 * 官方 protobuf 的事件号（`common/events.proto` 的 `Type` 枚举）。
 *
 * 这里只列同传链路用得到的那些；宿主按同样的编号解析服务端响应。
 */
export const INTERPRETATION_EVENTS = {
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  UsageResponse: 154,
  TaskRequest: 200,
  TTSResponse: 352,
  SourceSubtitleStart: 1418,
  SourceSubtitleResponse: 1419,
  SourceSubtitleEnd: 1420,
  TranslationSubtitleStart: 1421,
  TranslationSubtitleResponse: 1422,
  TranslationSubtitleEnd: 1423,
} as const

/** 同传的两种模式：语音转文字（s2t）与语音转语音（s2s）。 */
export const INTERPRETATION_MODES = ['s2t', 's2s'] as const

/**
 * 建连用的请求头。
 *
 * 官方要求 `X-Api-Key`、`X-Api-Resource-Id` 与 `X-Api-Connect-Id`；
 * 真正的 key 由宿主从 `ctx.secret` 取，不写在这里。
 */
export function interpretationHeaders(apiKey: string, connectId: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': INTERPRETATION_RESOURCE_ID,
    'X-Api-Connect-Id': connectId,
  }
}

export interface InterpretationOptions {
  /** `s2t`（默认）或 `s2s`。 */
  mode?: string
  sourceLanguage: string
  targetLanguage: string
  /** 调用方额外给的官方字段，原样保留。 */
  request?: Json
  /** 会话 ID；不传就生成一个。 */
  sessionId?: string
}

/**
 * 构造「开始会话」的请求体（官方 `TranslateRequest`）。
 *
 * 字段与官方示例一致：`request_meta.SessionID`、`event`、`user`、
 * `source_audio` 与 `request`；`s2s` 还要补 `target_audio` 并校验其取值。
 */
export function interpretationStartRequest(options: InterpretationOptions): Json {
  const mode = options.mode ?? 's2t'
  if (!INTERPRETATION_MODES.includes(mode as (typeof INTERPRETATION_MODES)[number]))
    throw new ProviderError('invalid_input', 'mode must be s2t or s2s')
  if (!options.sourceLanguage.trim())
    throw new ProviderError('invalid_input', 'source_language is required')
  if (!options.targetLanguage.trim())
    throw new ProviderError('invalid_input', 'target_language is required')
  const body = { ...options.request }
  for (const name of ['request_meta', 'source_audio', 'request', 'target_audio']) {
    if (name in body && !isJson(body[name]))
      throw new ProviderError('invalid_input', `${name} must be an object`)
  }
  const sessionId = options.sessionId ?? crypto.randomUUID()
  const sourceAudio: Json = {
    ...asJson(body.source_audio),
    format: 'wav',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1,
  }
  for (const name of ['binary_data', 'data', 'url']) delete sourceAudio[name]
  const result: Json = {
    ...body,
    request_meta: { ...asJson(body.request_meta), SessionID: sessionId },
    event: INTERPRETATION_EVENTS.StartSession,
    user: body.user ?? { uid: 'modelbay' },
    source_audio: sourceAudio,
    request: {
      ...asJson(body.request),
      mode,
      source_language: options.sourceLanguage,
      target_language: options.targetLanguage,
    },
  }
  if (mode === 's2s') {
    const target: Json = { ...asJson(body.target_audio) }
    if (target.format === undefined) target.format = 'pcm'
    if (target.rate === undefined) target.rate = target.format === 'ogg_opus' ? 48000 : 16000
    if (target.bits === undefined)
      target.bits = target.rate === 24000 || target.format === 'ogg_opus' ? 32 : 16
    if (target.channel === undefined) target.channel = 1
    const format = target.format
    const rate = target.rate
    const bits = target.bits
    if (format !== 'pcm' && format !== 'ogg_opus')
      throw new ProviderError('invalid_input', 'target_audio supports pcm or ogg_opus')
    if (format === 'pcm' && rate !== 16000 && rate !== 24000)
      throw new ProviderError('invalid_input', 'target_audio pcm rate must be 16000 or 24000')
    if (format === 'ogg_opus' && rate !== 48000)
      throw new ProviderError('invalid_input', 'target_audio ogg_opus rate must be 48000')
    if (target.channel !== 1) throw new ProviderError('invalid_input', 'target_audio must be mono')
    if (format === 'pcm' && bits !== (rate === 24000 ? 32 : 16))
      throw new ProviderError(
        'invalid_input',
        'target_audio pcm uses 16 bit at 16000 Hz and float32 at 24000 Hz',
      )
    result.target_audio = target
  }
  return result
}

/**
 * 把 PCM 切成 80ms 一片。
 *
 * 上传的必须是 16bit PCM（不含 WAV 头），长度要按采样帧对齐。
 */
export function interpretationChunks(pcm: Uint8Array): Uint8Array[] {
  if (!pcm.length) throw new ProviderError('invalid_input', 'audio is empty')
  if (pcm.length % 2)
    throw new ProviderError('invalid_input', 'audio is not complete 16-bit PCM samples')
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < pcm.length; offset += INTERPRETATION_CHUNK_BYTES) {
    chunks.push(pcm.subarray(offset, Math.min(offset + INTERPRETATION_CHUNK_BYTES, pcm.length)))
  }
  return chunks
}
