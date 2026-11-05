/**
 * Node-only streaming ASR session (`@modelbay/doubao-speech/asr`).
 *
 * The Doubao/Volcengine streaming ASR protocol gzips every JSON/audio frame
 * behind a 12-byte binary header. `node:zlib` and `Buffer` are Node-specific, so
 * this module is intentionally kept out of the root entry and exported from an
 * optional subpath.
 *
 * Protocol (official "大模型流式语音识别API" doc):
 * -  双向流式：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
 * -  单流（流式输入、末尾统一返回）：`.../api/v3/sauc/bigmodel_nostream`
 * -  资源 ID `volc.seedasr.sauc.duration`
 *
 * The frame codec below was ported from the Python implementation in
 * `hoobnn-mcps/servers/doubao-speech/src/doubao_speech_mcp/streaming_asr.py`.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { ProviderError, type AdapterContext } from '@modelbay/core'
import { firstSecret, type Json } from '../http'
import { readPcm, type PcmAudio } from './pcm'

/** 流式输入、边发边返回的双向流式接口。 */
export const ASR_ASYNC_PATH = '/api/v3/sauc/bigmodel_async'
/** 流式输入、末尾统一返回的单流接口。 */
export const ASR_NOSTREAM_PATH = '/api/v3/sauc/bigmodel_nostream'
export const ASR_HOST = 'wss://openspeech.bytedance.com'
/** 豆包流式语音识别模型的资源 ID。 */
export const ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'
/** 官方示例按 200ms 一片发送音频。 */
export const ASR_SEGMENT_MS = 200

export interface AsrFrame {
  /** Frame type: 1 = JSON request, 2 = audio chunk, 9 = response, 15 = error. */
  type: number
  /** Monotonic sequence; negative marks the last audio frame. */
  sequence: number
  payload: Uint8Array
}

/** Serialize a frame: 12-byte header followed by gzip-compressed payload. */
export function encodeAsrFrame(frame: AsrFrame): Uint8Array {
  const compressed = gzipSync(Buffer.from(frame.payload))
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (frame.type << 4) | (frame.sequence < 0 ? 3 : 1)
  header[2] = frame.type === 1 ? 0x11 : 0x01
  header.writeInt32BE(frame.sequence, 4)
  header.writeUInt32BE(compressed.length, 8)
  return new Uint8Array(Buffer.concat([header, compressed]))
}

export interface DecodedAsrFrame {
  final: boolean
  type: number
  data: Record<string, unknown>
}

/**
 * 解析服务端的响应帧（类型 9）或错误帧（类型 15）。
 *
 * 帧头规则与官方文档一致：标志位 0x1 表示带 4 字节序号，0x2 表示这是最后一条；
 * 错误帧在序号之后是 4 字节错误码，再之后是负载长度。
 */
export function decodeAsrFrame(bytes: Uint8Array): DecodedAsrFrame {
  const invalid = () =>
    new ProviderError('unavailable', 'Streaming ASR returned incomplete data', {
      outcome: 'unknown',
      retryable: false,
    })
  const data = Buffer.from(bytes)
  if (data.length < 8 || data[0]! >> 4 !== 1) throw invalid()
  const flags = data[1]! & 15
  const type = data[1]! >> 4
  let offset = (data[0]! & 15) * 4
  if (offset < 4) throw invalid()
  let sequence: number | null = null
  if (flags & 1) {
    if (data.length < offset + 4) throw invalid()
    sequence = data.readInt32BE(offset)
    offset += 4
  }
  if (type === 15) {
    if (data.length < offset + 8) throw invalid()
    const code = data.readUInt32BE(offset)
    throw new ProviderError(
      code === 45000001 ? 'invalid_input' : 'unavailable',
      `Streaming ASR error ${code}`,
      {
        retryable: false,
      },
    )
  }
  if (type !== 9) throw invalid()
  if (data.length < offset + 4) throw invalid()
  const size = data.readUInt32BE(offset)
  offset += 4
  if (offset + size !== data.length) throw invalid()
  let body = data.subarray(offset)
  if ((data[2]! & 15) === 1) body = gunzipSync(body, { maxOutputLength: 8 * 1024 * 1024 })
  if (data[2]! >> 4 !== 1) throw invalid()
  return {
    // 结束包：标志位 0x2，或者序号为负。
    final: Boolean(flags & 2) || (sequence !== null && sequence < 0),
    type,
    data: JSON.parse(body.toString()) as Record<string, unknown>,
  }
}

/** 两种流式识别模式。 */
export type AsrMode = 'realtime' | 'sentence'

/** 宿主注入的二进制 WebSocket 工厂。 */
export type AsrSocketFactory = (url: string, headers: Record<string, string>) => Promise<AsrSocket>

export interface AsrSocket {
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}

/** 建连用的请求头。 */
export function asrHeaders(
  apiKey: string,
  options: { requestId?: string; resourceId?: string } = {},
): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': options.resourceId ?? ASR_RESOURCE_ID,
    'X-Api-Request-Id': options.requestId ?? crypto.randomUUID(),
    'X-Api-Sequence': '-1',
  }
}

export interface AsrStreamOptions {
  /** 本地 .wav / .pcm 路径。 */
  audio: string
  /** realtime（双流，边发边返回）或 sentence（末尾统一返回）。 */
  mode?: AsrMode
  /** 覆盖资源 ID，默认 `volc.seedasr.sauc.duration`。 */
  resourceId?: string
  /** 官方的其余请求字段，原样合并进 `request` 段。 */
  parameters?: Json
  /** 每片音频的时长（毫秒），默认 200。 */
  segmentMs?: number
  /** 是否按真实节奏上传音频（默认开；测试里可以关掉）。 */
  pace?: boolean
}

/** 一次流式识别的结果。 */
export interface AsrStreamResult {
  /** 识别文本。 */
  text: string
  /** 服务端最后一条完整响应。 */
  response: Json | null
  /** 收到的全部服务端响应。 */
  messages: Json[]
  /** 本次请求 ID。 */
  requestId: string
  /** 服务端日志 ID。 */
  logId: string | null
}

/**
 * 完整客户端请求体（官方协议里的 `user` / `audio` / `request` 三段）。
 *
 * WAV 的容器头在本地就被剥掉了，所以线上传的必须是 PCM。
 */
export function asrPayload(
  pcm: PcmAudio,
  options: { parameters?: Json; enableNonStream?: boolean } = {},
): Json {
  if (pcm.bits !== 16) throw new ProviderError('invalid_input', '流式识别仅支持 16-bit PCM')
  if (pcm.channel !== 1 && pcm.channel !== 2)
    throw new ProviderError('invalid_input', '流式识别的声道数必须为 1 或 2')
  if (!Number.isInteger(pcm.rate) || pcm.rate <= 0)
    throw new ProviderError('invalid_input', 'audio.rate 必须为正整数')
  const alignment = pcm.channel * 2
  if (!pcm.data.length || pcm.data.length % alignment !== 0)
    throw new ProviderError('invalid_input', 'PCM 为空或未按采样帧对齐')
  const request: Json = {
    model_name: 'bigmodel',
    enable_itn: true,
    enable_punc: true,
    show_utterances: true,
    ...(options.enableNonStream === undefined ? {} : { enable_nonstream: options.enableNonStream }),
    ...asJson(options.parameters?.request),
  }
  return {
    user: { uid: 'modelbay' },
    audio: {
      format: 'pcm',
      rate: pcm.rate,
      bits: pcm.bits,
      channel: pcm.channel,
      ...asJson(options.parameters?.audio),
    },
    request,
  }
}

/** 把 PCM 切成官方建议的音频片（默认 200ms 一片）。 */
export function asrSegments(pcm: PcmAudio, options: { segmentMs?: number } = {}): Uint8Array[] {
  const segmentMs = options.segmentMs ?? ASR_SEGMENT_MS
  const frameSize = (pcm.channel * pcm.bits) / 8
  if (!pcm.data.length) throw new ProviderError('invalid_input', '识别音频为空')
  if (pcm.data.length % frameSize !== 0)
    throw new ProviderError('invalid_input', 'PCM 未按采样帧对齐')
  const bytesPerSegment = Math.max(frameSize, Math.round((pcm.rate * segmentMs) / 1000) * frameSize)
  const segments: Uint8Array[] = []
  for (let offset = 0; offset < pcm.data.length; offset += bytesPerSegment) {
    segments.push(pcm.data.subarray(offset, Math.min(offset + bytesPerSegment, pcm.data.length)))
  }
  return segments
}

/** 从服务端的响应里取识别文本。 */
function transcriptOf(data: Json): string {
  const result = asJson(data.result)
  return typeof result.text === 'string' ? result.text : ''
}

/**
 * 跑一次流式识别。
 *
 * 流程与 Python 版 `streaming_recognize` 一致：发完整客户端请求 → 按片发音频
 * （最后一片用负序号标记结束）→ 收服务端的识别结果 → 收到结束包或连接关闭为止。
 */
export async function transcribeStream(
  ctx: AdapterContext,
  options: AsrStreamOptions,
  socket?: AsrSocketFactory,
): Promise<AsrStreamResult> {
  const mode = options.mode ?? 'realtime'
  if (mode !== 'realtime' && mode !== 'sentence')
    throw new ProviderError('invalid_input', 'mode must be realtime or sentence')
  const apiKey = firstSecret(ctx, ['DOUBAO_API_KEY', 'VOLC_SPEECH_API_KEY'])
  if (!apiKey) throw new ProviderError('auth', '流式识别需要 DOUBAO_API_KEY')
  const pcm = readPcm(options.audio)
  const requestId = crypto.randomUUID()
  const path = mode === 'realtime' ? ASR_ASYNC_PATH : ASR_NOSTREAM_PATH
  const url = `${ASR_HOST}${path}`
  const headers = asrHeaders(apiKey, { requestId, resourceId: options.resourceId })
  const payload = asrPayload(pcm, {
    parameters: options.parameters,
    enableNonStream: mode === 'sentence',
  })
  const segments = asrSegments(pcm, { segmentMs: options.segmentMs })
  const remote = socket ? await socket(url, headers) : await connectWithWs(url, headers)

  const messages: Json[] = []
  let text = ''
  let response: Json | null = null
  try {
    // 完整客户端请求：序号 1，类型 1（JSON）。
    remote.send(
      encodeAsrFrame({
        type: 1,
        sequence: 1,
        payload: new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf8')),
      }),
    )
    // 音频片：序号从 2 开始，最后一片用负序号标记结束。
    for (const [index, segment] of segments.entries()) {
      const last = index === segments.length - 1
      remote.send(
        encodeAsrFrame({ type: 2, sequence: last ? -(index + 2) : index + 2, payload: segment }),
      )
      if (options.pace !== false && !last) {
        await new Promise((resolve) => setTimeout(resolve, options.segmentMs ?? ASR_SEGMENT_MS))
      }
    }
    // 收尾：一直读到结束包或连接关闭。
    for (;;) {
      const frame = await remote.receive()
      if (!frame.length) break
      const decoded = decodeAsrFrame(frame)
      messages.push(decoded.data)
      response = decoded.data
      const piece = transcriptOf(decoded.data)
      if (piece) text = piece
      if (decoded.final) break
    }
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause
    throw new ProviderError('unavailable', '流式识别未完成；没有拿到最终结果', {
      outcome: 'unknown',
      cause,
    })
  } finally {
    remote.close()
  }
  if (!text) throw new ProviderError('unknown', '流式识别没有返回识别结果', { outcome: 'unknown' })
  return { text, response, messages, requestId, logId: null }
}

/**
 * 用 `ws` 建立连接。
 *
 * `ws` 是 Node 专属依赖（MIT），由集成方安装；没装时给出明确的错误。
 */
async function connectWithWs(url: string, headers: Record<string, string>): Promise<AsrSocket> {
  let ws: typeof import('ws')
  try {
    ws = await import('ws')
  } catch (cause) {
    throw new ProviderError(
      'unavailable',
      '流式识别需要安装 ws（MIT，Node 专属依赖），或自行传入 socket 工厂',
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

function asJson(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

/**
 * `speech_raw_request(product='asr_stream')` 的实现入口。
 *
 * 参数与 Python 版一致：`audio` 是本地 WAV / PCM 路径，`mode` 是 realtime 或 sentence，
 * `request` 是官方的完整请求体（`audio` / `request` 两段原样合并）。
 */
export async function runAsrStream(
  ctx: AdapterContext,
  params: Json,
  socket?: AsrSocketFactory,
): Promise<Json> {
  const audio = typeof params.audio === 'string' ? params.audio : ''
  if (!audio) throw new ProviderError('invalid_input', 'asr_stream 需要 audio 文件路径')
  const mode = params.mode === 'sentence' ? 'sentence' : 'realtime'
  const request = asJson(params.request)
  const result = await transcribeStream(
    ctx,
    {
      audio,
      mode,
      ...(typeof params.resource_id === 'string' ? { resourceId: params.resource_id } : {}),
      parameters: request,
    },
    socket,
  )
  return { ok: true, text: result.text, response: result.response, messages: result.messages }
}
