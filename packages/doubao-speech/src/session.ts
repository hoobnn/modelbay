/**
 * 豆包实时对话会话（Seeduplex / Seed-Realtime）。
 *
 * 官方协议是 JSON 文本帧的 WebSocket：先发 `session.create`，等服务端回
 * `session.created`，之后就是请求/响应事件流。`AdapterContext` 只注入 `fetch`，
 * 带不动 WebSocket，所以连接由宿主的 socket 工厂提供；没提供时用 `ws`（MIT，
 * 可选 peer 依赖）。
 */
import { ProviderError, type RealtimeSession } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { API_KEY_NAMES, asJson, firstSecret, hasCredentials, type Json } from './http'

export const REALTIME_DIALOGUE_PATH = '/api/v3/duplex/realtime/dialogue'
export const REALTIME_SEED_PATH = '/api/v3/seedrealtime'
export const REALTIME_BIDIRECTION_PATH = '/api/v3/tts/bidirection'
export const REALTIME_HOST = 'wss://openspeech.bytedance.com'

/** 实时对话的两种模式，各自绑定一个 `session.model` 与接口路径。 */
export type RealtimeMode = 'legacy' | 'seed'

export const REALTIME_MODES: Record<RealtimeMode, { model: string; path: string }> = {
  legacy: { model: '1.2.6.1', path: REALTIME_DIALOGUE_PATH },
  seed: { model: '1.3.0.0', path: REALTIME_SEED_PATH },
}

export interface RealtimeSessionConfig {
  /** WebSocket path on `wss://openspeech.bytedance.com`. */
  path?: string
  resourceId?: string
  /** Extra headers; credentials are added by the host, never stored here. */
  headers?: Record<string, string>
  /** `session.create` 的 session 段（官方字段原样保留）。 */
  session?: Json
  /** seed 模式的扩展字段（如 `extension.video`）。 */
  extension?: Json
  /** 实时对话模式，默认 legacy。 */
  mode?: RealtimeMode
}

/** A host-injected binary WebSocket factory (not part of `AdapterContext`). */
export type RealtimeSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => Promise<{
  logId?: string
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}>

export interface RealtimeSessionHandle extends RealtimeSession {
  readonly id: string
  readonly state: 'open' | 'closed'
  /** 建连时发给服务端的 `session.create` 事件。 */
  readonly event: Json
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 解析服务端发来的 JSON 文本帧。 */
export function parseRealtimeEvent(bytes: Uint8Array): Json {
  const raw = decoder.decode(bytes).trim()
  if (!raw) throw new ProviderError('unknown', '实时会话返回了空事件')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new ProviderError('unknown', '实时会话返回的不是合法 JSON 事件', { cause })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ProviderError('unknown', '实时会话返回的事件不是对象')
  const event = parsed as Json
  if (typeof event.type !== 'string')
    throw new ProviderError('unknown', '实时会话返回的事件缺少 type')
  return event
}

export interface RealtimeEventOptions {
  mode?: RealtimeMode
  extension?: Json
  eventId?: string
}

/**
 * 按官方协议构造 `session.create` 事件。
 *
 * 只填官方允许的默认值：输入音频固定 16000Hz 的 pcm / speech_opus，
 * 输出音频固定 24000Hz 的 pcm / pcm_s16le / ogg_opus 且必须给音色；
 * `session.video` 不合法，视频要走 `extension.video`（只有 seed 模式支持）。
 */
export function createRealtimeEvent(session: Json, options: RealtimeEventOptions = {}): Json {
  const mode = options.mode ?? 'legacy'
  const spec = REALTIME_MODES[mode]
  if (!spec) throw new ProviderError('invalid_input', 'mode must be legacy or seed')
  const config: Json = { ...session }
  if (config.model === undefined) config.model = spec.model
  if (config.model !== spec.model)
    throw new ProviderError('invalid_input', `${mode} session.model must be ${spec.model}`)
  if ('video' in config)
    throw new ProviderError(
      'invalid_input',
      'video config belongs in extension.video, not session.video',
    )
  const audio: Json = { ...asJson(config.audio) }
  const input: Json = { ...asJson(audio.input) }
  const inputFormat: Json =
    input.format === undefined ? { type: 'pcm', rate: 16000 } : { ...(input.format as Json) }
  const output: Json = { ...asJson(audio.output) }
  const outputFormat: Json =
    output.format === undefined
      ? { type: 'pcm_s16le', rate: 24000 }
      : { ...(output.format as Json) }
  if (typeof output.voice !== 'string' || !output.voice)
    throw new ProviderError('invalid_input', 'session.audio.output.voice is required')
  if (inputFormat.rate !== 16000)
    throw new ProviderError('invalid_input', 'input audio must be 16000 Hz')
  if (inputFormat.type === 'opus') inputFormat.type = 'speech_opus'
  if (inputFormat.type !== 'pcm' && inputFormat.type !== 'speech_opus')
    throw new ProviderError('invalid_input', 'input audio must be pcm or speech_opus')
  if (
    (outputFormat.type !== 'pcm' &&
      outputFormat.type !== 'pcm_s16le' &&
      outputFormat.type !== 'ogg_opus') ||
    outputFormat.rate !== 24000
  )
    throw new ProviderError(
      'invalid_input',
      'output audio must be pcm / pcm_s16le / ogg_opus at 24000 Hz',
    )
  audio.input = { ...input, format: inputFormat }
  audio.output = { ...output, format: outputFormat }
  config.audio = audio
  const event: Json = {
    type: 'session.create',
    session: config,
    event_id: options.eventId ?? crypto.randomUUID(),
  }
  if (options.extension !== undefined) {
    if (
      options.extension === null ||
      typeof options.extension !== 'object' ||
      Array.isArray(options.extension)
    )
      throw new ProviderError('invalid_input', 'extension must be an object')
    if ('video' in options.extension) validateRealtimeVideo(options.extension.video, mode)
    event.extension = { ...options.extension }
  }
  return event
}

/** seed 模式的视频输入：帧格式只支持 PNG / JPEG，帧率大于 0 且不超过 2 FPS。 */
export function validateRealtimeVideo(video: unknown, mode: RealtimeMode): void {
  if (mode !== 'seed')
    throw new ProviderError('invalid_input', 'video / image input requires mode=seed')
  if (video === null || typeof video !== 'object' || Array.isArray(video))
    throw new ProviderError('invalid_input', 'extension.video must be an object')
  const frameFormat = (video as Json).frame_format
  if (frameFormat !== 'PNG' && frameFormat !== 'JPEG')
    throw new ProviderError('invalid_input', 'extension.video.frame_format must be PNG or JPEG')
  if ('frame_rate' in (video as Json)) {
    const value = (video as Json).frame_rate
    const rate = typeof value === 'number' ? value : Number.NaN
    if (typeof value === 'boolean' || !Number.isFinite(rate) || rate <= 0 || rate > 2)
      throw new ProviderError(
        'invalid_input',
        'extension.video.frame_rate must be greater than 0 and at most 2 FPS',
      )
  }
}

/**
 * In-memory session: frames sent by the caller are queued for `receive()`.
 * Useful for tests and for hosts that have not wired a real socket yet.
 */
export class InMemoryRealtimeSession implements RealtimeSessionHandle {
  readonly id: string
  readonly event: Json
  state: 'open' | 'closed' = 'open'
  private readonly queue: Uint8Array[] = []
  private readonly waiters: Array<(frame: Uint8Array) => void> = []

  constructor(config: RealtimeSessionConfig = {}) {
    this.id = config.resourceId ?? 'realtime-placeholder'
    this.event = { type: 'session.create' }
  }

  send(data: Uint8Array): void {
    if (this.state === 'closed') throw new ProviderError('cancelled', 'Realtime session is closed')
    const waiter = this.waiters.shift()
    if (waiter) waiter(data)
    else this.queue.push(data)
  }

  receive(): Promise<Uint8Array> {
    if (this.state === 'closed')
      return Promise.reject(new ProviderError('cancelled', 'Realtime session is closed'))
    const next = this.queue.shift()
    if (next) return Promise.resolve(next)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    for (const waiter of this.waiters.splice(0)) waiter(new Uint8Array())
  }
}

/**
 * Open a realtime session.
 *
 * 先按官方协议校验并发出 `session.create`，等服务端回 `session.created` 才算建连成功；
 * 回执不对就报错，不把半开的会话交给宿主。
 */
export async function openRealtimeSession(
  ctx: AdapterContext,
  config: RealtimeSessionConfig = {},
  socket?: RealtimeSocketFactory,
): Promise<RealtimeSessionHandle> {
  const key = firstSecret(ctx, API_KEY_NAMES)
  if (!hasCredentials(ctx))
    throw new ProviderError('auth', 'Realtime session requires DOUBAO credentials')
  const mode = config.mode ?? 'legacy'
  const event = createRealtimeEvent(config.session ?? {}, {
    mode,
    ...(config.extension === undefined ? {} : { extension: config.extension }),
  })
  const url = `${REALTIME_HOST}${config.path ?? REALTIME_MODES[mode].path}`
  const headers = {
    ...config.headers,
    ...(key ? { 'X-Api-Key': key } : {}),
  }
  const remote = socket ? await socket(url, headers) : await connectWithWs(url, headers)
  remote.send(encoder.encode(JSON.stringify(event)))
  const ack = parseRealtimeEvent(await remote.receive())
  if (ack.type !== 'session.created')
    throw new ProviderError('invalid_input', `session.create was rejected: ${ack.type}`)
  let closed = false
  const acknowledged = ack.session && typeof ack.session === 'object' ? (ack.session as Json) : {}
  const wrapped: RealtimeSessionHandle = {
    id: remote.logId ?? String(acknowledged.id ?? config.resourceId ?? 'realtime'),
    event,
    get state(): 'open' | 'closed' {
      return closed ? 'closed' : 'open'
    },
    send: (data) => {
      if (closed) throw new ProviderError('cancelled', 'Realtime session is closed')
      remote.send(data)
    },
    receive: () => remote.receive(),
    close: () => {
      closed = true
      remote.close()
    },
  }
  return wrapped
}

/**
 * 用 `ws` 建立连接。
 *
 * `ws` 是 Node 专属依赖（MIT），由集成方安装；没装时给出明确的错误。
 */
async function connectWithWs(
  url: string,
  headers: Record<string, string>,
): Promise<Awaited<ReturnType<RealtimeSocketFactory>>> {
  let ws: typeof import('ws')
  try {
    ws = await import('ws')
  } catch (cause) {
    throw new ProviderError(
      'unavailable',
      '实时会话需要安装 ws（MIT，Node 专属依赖），或自行传入 socket 工厂',
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
