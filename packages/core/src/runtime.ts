/**
 * 核心运行时：宿主差异通过接口注入，自带默认实现。
 * 只使用 fetch / Uint8Array / AbortSignal / crypto.subtle 这类各运行时都有的 API。
 */
import type { ProviderOutput, ProviderUsage, SubmitResult, PollResult } from './provider'
import { ProviderError } from './provider'

// ── 事件钩子：库代码不写 console.*，进度和用量都通过钩子上报 ──────────────

export interface UsageEvent extends ProviderUsage {
  platform?: string
  capability?: string
  model?: string
}

export interface ProgressEvent {
  platform?: string
  remoteId?: string
  state: 'submitted' | 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
}

export interface ModelbayHooks {
  onUsage?(event: UsageEvent): void
  onProgress?(event: ProgressEvent): void
  onLog?(message: string, data?: Record<string, unknown>): void
}

export function emitUsage(hooks: ModelbayHooks | undefined, event: UsageEvent): void {
  hooks?.onUsage?.(event)
}

export function emitProgress(hooks: ModelbayHooks | undefined, event: ProgressEvent): void {
  hooks?.onProgress?.(event)
}

// ── 异步任务持久化：默认存内存，宿主可注入 SQLite 实现 ────────────────────

export interface JobRecord {
  id: string
  remoteId: string
  platform: string
  capability: string
  state: 'pending' | 'succeeded' | 'failed'
  createdAt: number
  outputs?: ProviderOutput[]
  usage?: ProviderUsage
  error?: string
}

export interface JobStore {
  save(record: JobRecord): void | Promise<void>
  get(id: string): JobRecord | undefined | Promise<JobRecord | undefined>
  list(): JobRecord[] | Promise<JobRecord[]>
}

export class InMemoryJobStore implements JobStore {
  private readonly records = new Map<string, JobRecord>()

  save(record: JobRecord): void {
    this.records.set(record.id, { ...record })
  }

  get(id: string): JobRecord | undefined {
    return this.records.get(id)
  }

  list(): JobRecord[] {
    return [...this.records.values()]
  }
}

export interface RunJobOptions {
  submit: () => Promise<SubmitResult>
  poll?: (remoteId: string) => Promise<PollResult>
  platform: string
  capability: string
  hooks?: ModelbayHooks
  store?: JobStore
  signal?: AbortSignal
  /** 最长等待时间，默认 10 分钟 */
  maxWaitMs?: number
}

export interface JobOutcome {
  outputs: ProviderOutput[]
  usage?: ProviderUsage
  remoteId?: string
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new ProviderError('cancelled', '任务已取消'))
      },
      { once: true },
    )
  })
}

/** 提交 + 轮询的完整生命周期：外部项目不用自己写轮询（G3） */
export async function runJob(options: RunJobOptions): Promise<JobOutcome> {
  const { submit, poll, hooks, store, signal, platform, capability } = options
  const maxWaitMs = options.maxWaitMs ?? 600_000
  const started = Date.now()
  const submitted = await submit()
  emitProgress(hooks, { platform, state: 'submitted' })

  if (submitted.state === 'succeeded') {
    emitUsage(hooks, { ...submitted.usage, platform, capability })
    emitProgress(hooks, { platform, state: 'succeeded' })
    return { outputs: submitted.outputs, ...(submitted.usage ? { usage: submitted.usage } : {}) }
  }

  if (!poll) throw new ProviderError('unavailable', '平台返回了异步任务，但没有实现轮询')

  const id = crypto.randomUUID()
  const record: JobRecord = {
    id,
    remoteId: submitted.remoteId,
    platform,
    capability,
    state: 'pending',
    createdAt: Date.now(),
  }
  await store?.save(record)

  let wait = submitted.pollAfterMs ?? 1000
  for (;;) {
    if (signal?.aborted) throw new ProviderError('cancelled', '任务已取消')
    if (Date.now() - started > maxWaitMs) {
      throw new ProviderError('timeout', `任务超过 ${maxWaitMs}ms 仍未完成`)
    }
    await delay(wait, signal)
    const result = await poll(submitted.remoteId)
    if (result.state === 'pending') {
      wait = result.pollAfterMs ?? wait
      emitProgress(hooks, {
        platform,
        remoteId: submitted.remoteId,
        state: result.remote === 'running' ? 'running' : 'queued',
        ...(result.progress === undefined ? {} : { progress: result.progress }),
      })
      continue
    }
    if (result.state === 'failed') {
      record.state = 'failed'
      record.error = result.error.message
      await store?.save(record)
      emitProgress(hooks, { platform, remoteId: submitted.remoteId, state: 'failed' })
      throw new ProviderError(result.error.code, result.error.message, {
        retryable: result.error.retryable,
      })
    }
    record.state = 'succeeded'
    record.outputs = result.outputs
    record.usage = result.usage
    await store?.save(record)
    emitUsage(hooks, { ...result.usage, platform, capability })
    emitProgress(hooks, { platform, remoteId: submitted.remoteId, state: 'succeeded' })
    return {
      outputs: result.outputs,
      ...(result.usage ? { usage: result.usage } : {}),
      remoteId: submitted.remoteId,
    }
  }
}

// ── 素材来源：默认从 URL 读字节，宿主可以注入本地文件实现 ────────────────

export interface LoadedAsset {
  data: Uint8Array
  mime: string
  url?: string
}

export interface AssetSource {
  load(ref: string): Promise<LoadedAsset>
}

export class UrlAssetSource implements AssetSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async load(ref: string): Promise<LoadedAsset> {
    const response = await this.fetchImpl(ref)
    if (!response.ok)
      throw new ProviderError('unavailable', `素材读取失败：HTTP ${response.status}`)
    const mime = response.headers.get('content-type') ?? 'application/octet-stream'
    return { data: new Uint8Array(await response.arrayBuffer()), mime, url: ref }
  }
}

// ── 二进制工具：替代 Buffer，core 里不能用 Node 专属 API ─────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 夹具录制和日志脱敏：key、签名、账号 ID 一律替换成 <redacted> */
export function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<redacted>')
    .replace(/(sk-|api[_-]?key[=:]\s*)[A-Za-z0-9._-]+/gi, '$1<redacted>')
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /authorization|api[-_]?key|token|signature|secret/i.test(key)
      ? '<redacted>'
      : redact(value)
  }
  return out
}
