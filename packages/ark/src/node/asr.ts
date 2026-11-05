/**
 * Node-only Agent Plan ASR: the Volcengine streaming speech-recognition protocol
 * over a WebSocket with custom headers, exported from `@modelbay/ark/tos`.
 *
 * The root adapter never imports this file — it only points hosts at this subpath.
 * `node:zlib` provides the gzip compression the protocol requires; the WebSocket
 * itself comes from `ws` (MIT), which hosts install alongside this subpath.
 *
 * Protocol (official "接入语音模型" doc for 方舟 Agent Plan):
 * -  双向流式：`wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async`
 * -  单流（流式输入）：`wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream`
 * -  模型 `doubao-seed-asr-2.0` 对应 `X-Api-Resource-Id: volc.seedasr.sauc.duration`
 */
import { gzipSync, gunzipSync } from 'node:zlib'
import { ProviderError, type AdapterContext, type SubmitResult } from '@modelbay/core'
import { asJson, type Json } from '../http'

/** 方舟 Agent Plan 的流式语音识别接口（单流：流式输入、末尾统一返回）。 */
export const PLAN_ASR_PATH = '/api/v3/plan/sauc/bigmodel_nostream'
/** 方舟 Agent Plan 的流式语音识别接口（双流：边发边返回）。 */
export const PLAN_ASR_ASYNC_PATH = '/api/v3/plan/sauc/bigmodel_async'
export const PLAN_ASR_HOST = 'wss://openspeech.bytedance.com'
/** 豆包流式语音识别模型 2.0 的资源 ID。 */
export const PLAN_ASR_RESOURCE = 'volc.seedasr.sauc.duration'
/** 官方示例按 200ms 一片发送音频。 */
export const PLAN_ASR_SEGMENT_MS = 200

/** 完整客户端请求的消息类型。 */
const FULL_REQUEST = 1
/** 只含音频的请求。 */
const AUDIO_REQUEST = 2

/** Build one binary ASR frame (gzip-compressed payload + 12-byte header). */
export function asrFrame(type: number, sequence: number, payload: Uint8Array): Buffer {
  const compressed = gzipSync(payload)
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (type << 4) | (sequence < 0 ? 3 : 1)
  header[2] = type === 1 ? 0x11 : 0x01
  header.writeInt32BE(sequence, 4)
  header.writeUInt32BE(compressed.length, 8)
  return Buffer.concat([header, compressed])
}

/** Decode one binary ASR frame, validating sizes and gzip limits. */
export function asrPacket(bytes: Uint8Array): { final: boolean; data: Json } {
  const data = Buffer.from(bytes)
  const invalid = () =>
    new ProviderError('unavailable', 'Agent Plan 语音识别返回不完整数据', {
      outcome: 'unknown',
      retryable: false,
    })
  if (data.length < 8 || data[0]! >> 4 !== 1) throw invalid()
  const flags = data[1]! & 15
  const type = data[1]! >> 4
  let offset = (data[0]! & 15) * 4
  if (offset < 4) throw invalid()
  if (type === 15) {
    if (data.length < offset + 8) throw invalid()
    const code = data.readUInt32BE(offset)
    throw new ProviderError(
      code === 45000001 ? 'invalid_input' : 'unavailable',
      `Agent Plan 语音识别错误 ${code}`,
      { retryable: false },
    )
  }
  if (type !== 9) throw invalid()
  if (flags & 1) offset += 4
  if (flags & 4) offset += 4
  if (data.length < offset + 4) throw invalid()
  const size = data.readUInt32BE(offset)
  offset += 4
  if (offset + size !== data.length) throw invalid()
  let body = data.subarray(offset)
  if ((data[2]! & 15) === 1) body = gunzipSync(body, { maxOutputLength: 8 * 1024 * 1024 })
  if (data[2]! >> 4 !== 1) throw invalid()
  return { final: Boolean(flags & 2), data: asJson(JSON.parse(body.toString())) }
}

/** 一次流式识别的参数。 */
export interface PlanAsrOptions {
  /** 16-bit PCM 音频（不含 WAV 头）。 */
  audio: Uint8Array
  /** 采样率，默认 16000。 */
  rate?: number
  /** 采样位宽，默认 16。 */
  bits?: number
  /** 声道数，默认 1。 */
  channel?: number
  /** 识别语种，如 `zh-CN`；不传由模型自动识别。 */
  language?: string
  /** 是否开启逆文本正则化，默认 true。 */
  enableItn?: boolean
  /** 是否开启标点，默认 true。 */
  enablePunc?: boolean
  /** 是否返回分句信息，默认 true。 */
  showUtterances?: boolean
  /** 每片音频的时长（毫秒），默认 200。 */
  segmentMs?: number
  /** 用双流接口（边发边返回）还是单流接口（末尾统一返回）。 */
  duplex?: boolean
}

/** 宿主注入的二进制 WebSocket 工厂（`AdapterContext` 里没有 socket 钩子）。 */
export type PlanAsrSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => Promise<{
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}>

/** 生成一个请求 ID（UUID v4 形式）。 */
function requestId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * 建连用的请求头。
 *
 * 官方要求 `X-Api-Key`（方舟 Agent Plan 专属 API Key）、`X-Api-Resource-Id`、
 * `X-Api-Request-Id` 与 `X-Api-Connect-Id`；这里只放 key 本身，不落盘。
 */
export function planAsrHeaders(
  apiKey: string,
  options: { requestId?: string } = {},
): Record<string, string> {
  const id = options.requestId ?? requestId()
  return {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': PLAN_ASR_RESOURCE,
    'X-Api-Request-Id': id,
    'X-Api-Connect-Id': id,
  }
}

/**
 * 完整客户端请求体（官方协议里的 `user` / `audio` / `request` 三段）。
 *
 * 音频按 PCM 上报，所以 `format` 固定 `pcm`；采样率、位宽、声道跟调用方给的一致。
 */
export function planAsrPayload(options: PlanAsrOptions): Json {
  const rate = options.rate ?? 16000
  const bits = options.bits ?? 16
  const channel = options.channel ?? 1
  if (bits !== 16) throw new ProviderError('invalid_input', '流式识别仅支持 16-bit PCM')
  if (channel !== 1 && channel !== 2)
    throw new ProviderError('invalid_input', '流式识别的声道数必须为 1 或 2')
  if (!Number.isInteger(rate) || rate <= 0)
    throw new ProviderError('invalid_input', 'audio.rate 必须为正整数')
  const audio: Json = { format: 'pcm', codec: 'raw', rate, bits, channel }
  if (options.language) audio.language = options.language
  const request: Json = {
    model_name: 'bigmodel',
    enable_itn: options.enableItn ?? true,
    enable_punc: options.enablePunc ?? true,
    enable_ddc: true,
    show_utterances: options.showUtterances ?? true,
    enable_nonstream: options.duplex ? false : true,
  }
  return { user: { uid: 'modelbay' }, audio, request }
}

/**
 * 把 PCM 切成官方建议的音频片（默认 200ms 一片）。
 *
 * 音频长度必须按采样帧对齐，否则切片边界会截断一帧。
 */
export function planAsrSegments(audio: Uint8Array, options: PlanAsrOptions): Uint8Array[] {
  const rate = options.rate ?? 16000
  const bits = options.bits ?? 16
  const channel = options.channel ?? 1
  const segmentMs = options.segmentMs ?? PLAN_ASR_SEGMENT_MS
  const frameSize = (channel * bits) / 8
  if (!audio.length) throw new ProviderError('invalid_input', '识别音频为空')
  if (audio.length % frameSize !== 0) throw new ProviderError('invalid_input', 'PCM 未按采样帧对齐')
  const bytesPerSegment = Math.max(frameSize, Math.round((rate * segmentMs) / 1000) * frameSize)
  const segments: Uint8Array[] = []
  for (let offset = 0; offset < audio.length; offset += bytesPerSegment) {
    segments.push(audio.subarray(offset, Math.min(offset + bytesPerSegment, audio.length)))
  }
  return segments
}

/** 从服务端的响应里取识别文本。 */
function transcriptOf(data: Json): string {
  const result = asJson(data.result)
  const text = result.text
  return typeof text === 'string' ? text : ''
}

/**
 * 方舟套餐的流式语音识别。
 *
 * 走官方 WebSocket 协议：先发完整客户端请求，再按片发音频（最后一片打结束标记），
 * 收集服务端的识别结果。需要宿主提供 WebSocket：默认用 `ws`（MIT），
 * 也可以传入自己的 socket 工厂（例如测试或已有的连接池）。
 */
export async function transcribePlan(
  ctx: AdapterContext,
  options: PlanAsrOptions,
  socket?: PlanAsrSocketFactory,
): Promise<SubmitResult> {
  const apiKey = ctx.secret('ARK_AGENT_PLAN_API_KEY') ?? ctx.secret('ARK_API_KEY')
  if (!apiKey) throw new ProviderError('auth', '方舟套餐语音识别需要 ARK_AGENT_PLAN_API_KEY')
  const path = options.duplex ? PLAN_ASR_ASYNC_PATH : PLAN_ASR_PATH
  const url = `${PLAN_ASR_HOST}${path}`
  const headers = planAsrHeaders(apiKey)
  const payload = planAsrPayload(options)
  const segments = planAsrSegments(options.audio, options)
  const remote = socket ? await socket(url, headers) : await connectWithWs(url, headers)
  let text = ''
  const utterances: Json[] = []
  try {
    remote.send(asrFrame(FULL_REQUEST, 1, Buffer.from(JSON.stringify(payload), 'utf8')))
    for (const [index, segment] of segments.entries()) {
      const last = index === segments.length - 1
      remote.send(asrFrame(AUDIO_REQUEST, last ? -(index + 2) : index + 2, segment))
    }
    for (;;) {
      const frame = await remote.receive()
      if (!frame.length) break
      const packet = asrPacket(frame)
      const body = asJson(packet.data)
      const piece = transcriptOf(body)
      if (piece) text = piece
      const result = asJson(body.result)
      if (Array.isArray(result.utterances)) utterances.push(...result.utterances.map(asJson))
      if (packet.final) break
    }
  } finally {
    remote.close()
  }
  if (!text)
    throw new ProviderError('unknown', '方舟套餐语音识别没有返回识别结果', {
      outcome: 'unknown',
    })
  return {
    state: 'succeeded',
    outputs: [{ type: 'text', text }],
    usage: {
      seconds: Math.round((options.audio.length / 2 / (options.rate ?? 16000)) * 100) / 100,
    },
  }
}

/**
 * 用 `ws` 建立连接。
 *
 * `ws` 是 Node 专属依赖（MIT），由集成方安装；没装时给出明确的错误。
 */
async function connectWithWs(
  url: string,
  headers: Record<string, string>,
): Promise<Awaited<ReturnType<PlanAsrSocketFactory>>> {
  let ws: typeof import('ws')
  try {
    ws = await import('ws')
  } catch (cause) {
    throw new ProviderError('unavailable', '方舟套餐语音识别需要安装 ws（MIT，Node 专属依赖）', {
      cause,
    })
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
    if (waiter) waiter(bytes)
    else queue.push(bytes)
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
