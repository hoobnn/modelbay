/**
 * Node-only 同声传译会话（`@modelbay/doubao-speech/node`）。
 *
 * 官方协议：WSS + protobuf（`data.speech.ast.TranslateRequest` / `TranslateResponse`）。
 * 这里把完整链路接起来：读本地 PCM → 建连 → 开始会话 → 分片上传音频 →
 * 收字幕 / 目标语音 / 用量 → 结束会话。
 *
 * protobuf 编解码在 `./ast`（最小实现，不引入第三方库）；
 * WebSocket 用 `ws`（MIT，可选 peer 依赖），宿主也可以注入自己的 socket 工厂。
 */
import { ProviderError, type AdapterContext } from '@modelbay/core'
import type { Json } from '../http'
import { readPcm, type PcmAudio } from './pcm'
import {
  AST_EVENT,
  decodeTranslateResponse,
  encodeTranslateRequest,
  type AstCorpus,
  type TranslateResponseFields,
} from './ast'

export const INTERPRETATION_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate'
export const INTERPRETATION_RESOURCE_ID = 'volc.service_type.10053'
/** 音频分片大小：80ms、16000Hz、16bit、单声道 = 2560 字节。 */
export const INTERPRETATION_CHUNK_BYTES = 2560
export const INTERPRETATION_SAMPLE_RATE = 16000

/** 宿主注入的二进制 WebSocket 工厂。 */
export type InterpretationSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => Promise<InterpretationSocket>

export interface InterpretationSocket {
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}

export { readPcm, type PcmAudio }

/** 建连用的请求头。 */
export function interpretationHeaders(apiKey: string, connectId: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': INTERPRETATION_RESOURCE_ID,
    'X-Api-Connect-Id': connectId,
  }
}

export interface InterpretationSegment {
  text: string
  startMs: number
  endMs: number
  speakerChanged: boolean
}

export interface InterpretationResult {
  ok: boolean
  sourceText: string
  translationText: string
  sourceSegments: InterpretationSegment[]
  translationSegments: InterpretationSegment[]
  usage: Json[]
  /** s2s 时服务端返回的目标语音字节数。 */
  audioBytes: number
  error?: string
}

export interface InterpretOptions {
  /** 本地 .wav / .pcm 路径。 */
  audio: string
  /** 源语种。 */
  source_language: string
  /** 目标语种。 */
  target_language: string
  /** s2t（默认）只出字幕，s2s 另外合成目标语音。 */
  mode?: 's2t' | 's2s'
  /** s2s 的音色 ID。 */
  voice?: string
  /** s2s 的输出格式。 */
  output_format?: 'pcm' | 'ogg_opus'
  /** 识别热词。 */
  hotwords?: string[]
  /** 术语表：原文 → 译文。 */
  glossary?: Record<string, string>
  /** 官方的其余 TranslateRequest 字段，原样合并。 */
  parameters?: Json
  /** 是否按 80ms 的实时节奏上传音频（默认开；测试里可以关掉）。 */
  pace?: boolean
}

/** 把服务端的字幕事件归并成段落。 */
class SubtitleCollector {
  private readonly segments: InterpretationSegment[] = []
  private text = ''
  private startMs = 0
  private speakerChanged = false

  start(event: TranslateResponseFields): void {
    if (this.text) this.flush(event)
    this.text = event.text ?? ''
    this.startMs = event.startTime ?? 0
    this.speakerChanged = event.speakerChanged ?? false
  }

  append(event: TranslateResponseFields): void {
    this.text += event.text ?? ''
  }

  end(event: TranslateResponseFields): void {
    this.text += event.text ?? ''
    this.flush(event)
  }

  flush(event: TranslateResponseFields): void {
    if (!this.text) return
    this.segments.push({
      text: this.text,
      startMs: this.startMs,
      endMs: event.endTime ?? this.startMs,
      speakerChanged: this.speakerChanged,
    })
    this.text = ''
  }

  get result(): { text: string; segments: InterpretationSegment[] } {
    return { text: this.segments.map((item) => item.text).join(''), segments: this.segments }
  }
}

/**
 * 跑一次同传。
 *
 * 流程与 Python 版 `interpret_audio` 一致：开始会话 → 分片上传音频 →
 * 收译文与目标语音 → 结束会话。
 */
export async function interpretAudio(
  ctx: AdapterContext,
  options: InterpretOptions,
  socket?: InterpretationSocketFactory,
): Promise<InterpretationResult> {
  const mode = options.mode ?? 's2t'
  if (mode !== 's2t' && mode !== 's2s')
    throw new ProviderError('invalid_input', 'mode must be s2t or s2s')
  if (!options.source_language.trim() || !options.target_language.trim())
    throw new ProviderError('invalid_input', 'source_language and target_language are required')
  const apiKey = ctx.secret('DOUBAO_API_KEY') ?? ctx.secret('VOLC_SPEECH_API_KEY')
  if (!apiKey) throw new ProviderError('auth', '同传需要 DOUBAO_API_KEY')
  const pcm = readPcm(options.audio)
  if (!pcm.data.length) throw new ProviderError('invalid_input', '音频内容为空')
  const sessionId = crypto.randomUUID()
  const connectId = crypto.randomUUID()
  const remote = socket
    ? await socket(INTERPRETATION_ENDPOINT, interpretationHeaders(apiKey, connectId))
    : await connectWithWs(INTERPRETATION_ENDPOINT, interpretationHeaders(apiKey, connectId))

  const source = new SubtitleCollector()
  const translation = new SubtitleCollector()
  const usage: Json[] = []
  let audioBytes = 0
  const corpus = buildCorpus(options)

  const handle = (event: TranslateResponseFields): boolean => {
    switch (event.event) {
      case AST_EVENT.SessionStarted:
        return false
      case AST_EVENT.SessionFailed:
      case AST_EVENT.SessionCanceled:
        throw new ProviderError(
          'unknown',
          `同传失败：${event.statusCode ?? ''} ${event.message ?? ''}`.trim(),
          { cause: event },
        )
      case AST_EVENT.UsageResponse:
        usage.push((event.billing ?? {}) as Json)
        return false
      case AST_EVENT.TTSResponse:
        audioBytes += event.data?.length ?? 0
        return false
      case AST_EVENT.SourceSubtitleStart:
        source.start(event)
        return false
      case AST_EVENT.SourceSubtitleResponse:
        source.append(event)
        return false
      case AST_EVENT.SourceSubtitleEnd:
        source.end(event)
        return false
      case AST_EVENT.TranslationSubtitleStart:
        translation.start(event)
        return false
      case AST_EVENT.TranslationSubtitleResponse:
        translation.append(event)
        return false
      case AST_EVENT.TranslationSubtitleEnd:
        translation.end(event)
        return false
      case AST_EVENT.SessionFinished:
        return true
      default:
        return false
    }
  }

  try {
    // 开始会话：带上音频参数与翻译参数
    remote.send(
      encodeTranslateRequest({
        requestMeta: { sessionId, resourceId: INTERPRETATION_RESOURCE_ID },
        event: AST_EVENT.StartSession,
        user: { uid: 'modelbay' },
        sourceAudio: {
          format: 'wav',
          codec: 'raw',
          rate: pcm.rate,
          bits: pcm.bits,
          channel: pcm.channel,
        },
        targetAudio:
          mode === 's2s'
            ? {
                format: options.output_format === 'ogg_opus' ? 'ogg_opus' : 'pcm',
                rate: options.output_format === 'ogg_opus' ? 48000 : 16000,
                bits: options.output_format === 'ogg_opus' ? 32 : 16,
                channel: 1,
              }
            : undefined,
        request: {
          mode,
          sourceLanguage: options.source_language,
          targetLanguage: options.target_language,
          ...(options.voice ? { ttsResourceId: options.voice } : {}),
          ...(corpus ? { extra: corpus } : {}),
          ...asJson(options.parameters?.request),
        },
        ...(options.parameters?.denoise !== undefined
          ? { denoise: options.parameters.denoise === true }
          : {}),
      }),
    )

    // 会话开始后才发音频
    let started = false
    const startedAt = Date.now()
    for (let offset = 0; offset < pcm.data.length; offset += INTERPRETATION_CHUNK_BYTES) {
      if (!started) {
        const event = decodeTranslateResponse(await remote.receive())
        if (event.event !== AST_EVENT.SessionStarted) {
          if (event.event === AST_EVENT.SessionFailed) {
            throw new ProviderError('unknown', `同传启动失败：${event.message ?? ''}`)
          }
          throw new ProviderError('unknown', '同传没有返回 SessionStarted')
        }
        started = true
      }
      const chunk = pcm.data.subarray(offset, offset + INTERPRETATION_CHUNK_BYTES)
      remote.send(
        encodeTranslateRequest({
          requestMeta: { sessionId, resourceId: INTERPRETATION_RESOURCE_ID },
          event: AST_EVENT.TaskRequest,
          sourceAudio: { binaryData: chunk },
        }),
      )
      if (options.pace !== false) {
        const target = startedAt + (offset / INTERPRETATION_CHUNK_BYTES + 1) * 80
        const wait = target - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      }
    }
    remote.send(
      encodeTranslateRequest({
        requestMeta: { sessionId, resourceId: INTERPRETATION_RESOURCE_ID },
        event: AST_EVENT.FinishSession,
      }),
    )

    // 收尾：一直读到 SessionFinished 或连接结束
    for (;;) {
      const frame = await remote.receive()
      if (!frame.length) break
      const event = decodeTranslateResponse(frame)
      if (handle(event)) break
    }
  } finally {
    remote.close()
  }

  const sourceResult = source.result
  const translationResult = translation.result
  return {
    ok: true,
    sourceText: sourceResult.text,
    translationText: translationResult.text,
    sourceSegments: sourceResult.segments,
    translationSegments: translationResult.segments,
    usage,
    audioBytes,
  }
}

/** 热词与术语表 → 官方 Corpus（request.corpus）。 */
function buildCorpus(options: InterpretOptions): AstCorpus | undefined {
  const hotwords = options.hotwords ?? []
  const glossary = Object.entries(options.glossary ?? {})
  if (!hotwords.length && !glossary.length) return undefined
  return {
    hotWords: hotwords,
    glossary: glossary.map(([key, value]) => ({ key, value })),
  }
}

function asJson(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

/**
 * 用 `ws` 建连。
 *
 * `ws` 是 Node 专属依赖（MIT），由集成方安装；没装时给出明确的错误。
 */
async function connectWithWs(
  url: string,
  headers: Record<string, string>,
): Promise<InterpretationSocket> {
  let ws: typeof import('ws')
  try {
    ws = await import('ws')
  } catch (cause) {
    throw new ProviderError(
      'unavailable',
      '同传需要安装 ws（MIT，Node 专属依赖），或自行传入 socket 工厂',
      { cause },
    )
  }
  const socket = new ws.WebSocket(url, { headers })
  const queue: Uint8Array[] = []
  const waiters: Array<(frame: Uint8Array) => void> = []
  let failure: Error | undefined
  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer)
    const waiter = waiters.shift()
    if (waiter) waiter(new Uint8Array(bytes))
    else queue.push(new Uint8Array(bytes))
  })
  socket.on('error', (error: Error) => {
    failure = error
    for (const waiter of waiters.splice(0)) waiter(new Uint8Array())
  })
  socket.on('close', () => {
    for (const waiter of waiters.splice(0)) waiter(new Uint8Array())
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', (error: Error) => reject(error))
  })
  return {
    send: (data) => socket.send(data),
    receive: async () => {
      if (failure) throw failure
      const next = queue.shift()
      if (next) return next
      return new Promise<Uint8Array>((resolve) => waiters.push(resolve))
    },
    close: () => socket.close(),
  }
}
