/**
 * 异步任务与结果落盘。
 *
 * MCP server 不落盘任务记录：任务 ID 就是平台的 remoteId（`job_id` 与 `task_id` 同值），
 * 进程内只记下提交时的工具名与输出目录，供 `get_job` / `recover_job` / `list_jobs` 使用；
 * 别处提交的任务只要给 `task_id` 也能查。`wait` 秒内轮询 `adapter.poll()`。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ProviderError } from '@modelbay/core'
import type {
  AdapterContext,
  PlatformAdapter,
  PollResult,
  ProviderOutput,
  SubmitResult,
} from '@modelbay/core'
import { extensionFor, mimeFromName } from './assets'

/** `wait` 的上限（秒），与工具说明的 1–90 一致。 */
export const MAX_WAIT_SECONDS = 90

interface JobRecord {
  id: string
  tool: string
  outDir?: string
  state: 'running' | 'delivered' | 'failed'
  createdAt: string
}

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>()

  remember(id: string, tool: string, outDir: string | undefined): JobRecord {
    const record: JobRecord = {
      id,
      tool,
      ...(outDir ? { outDir } : {}),
      state: 'running',
      createdAt: new Date().toISOString(),
    }
    this.jobs.set(id, record)
    return record
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id)
  }

  list(limit: number): JobRecord[] {
    return [...this.jobs.values()].reverse().slice(0, limit)
  }
}

/** 取 `out_dir` / `output_directory`（两种写法都认）。 */
export function outputDirectory(args: Record<string, unknown>): string | undefined {
  const value = args.out_dir ?? args.output_directory
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** 取 `wait` 秒数，限制在 0–90。 */
export function waitSeconds(args: Record<string, unknown>): number {
  const value = Number(args.wait ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, MAX_WAIT_SECONDS)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        fail(new ProviderError('cancelled', '已取消'))
      },
      { once: true },
    )
  })
}

/** 轮询到结束或 `wait` 秒用完；`wait` 为 0 时只查一次。 */
export async function pollUntil(
  adapter: PlatformAdapter,
  id: string,
  context: AdapterContext,
  wait: number,
): Promise<PollResult> {
  if (!adapter.poll) throw new ProviderError('invalid_input', '该平台适配器不支持查询任务进度')
  const deadline = Date.now() + wait * 1000
  for (;;) {
    const result = await adapter.poll(id, context)
    if (result.state !== 'pending') return result
    const remaining = deadline - Date.now()
    if (remaining <= 0) return result
    await sleep(Math.min(result.pollAfterMs ?? 5000, remaining), context.signal)
  }
}

/** 提交后若是异步任务且给了 `wait`，接着轮询。 */
export async function settle(
  adapter: PlatformAdapter,
  submitted: SubmitResult,
  context: AdapterContext,
  wait: number,
): Promise<SubmitResult | PollResult> {
  if (submitted.state !== 'pending' || wait <= 0) return submitted
  const result = await pollUntil(adapter, submitted.remoteId, context, wait)
  return result.state === 'pending' ? submitted : result
}

let sequence = 0

function fileName(tool: string, index: number, output: Extract<ProviderOutput, { type: 'file' }>) {
  if (output.name && /\.[a-z0-9]+$/i.test(output.name)) return output.name
  const ext =
    extensionFor(output.mime) ||
    (output.url ? extensionFor(mimeFromName(output.url) ?? '') : '') ||
    '.bin'
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')
  sequence += 1
  return `${tool}-${stamp}-${sequence}-${index}${ext}`
}

/**
 * 把文件结果写到 `outDir`：字节直接写，URL 先下载。写好的条目带 `path`，不再带字节。
 * 没给 `outDir` 时原样返回（字节由路由层转成 MCP 内容块，URL 原样给出）。
 */
export async function deliver(
  outputs: readonly ProviderOutput[],
  outDir: string | undefined,
  tool: string,
  context: AdapterContext,
): Promise<unknown[]> {
  if (!outDir) return [...outputs]
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  return Promise.all(
    outputs.map(async (output, index) => {
      if (output.type !== 'file') return output
      let data = output.data
      if (!data && output.url) {
        const response = await context.fetch(output.url, { signal: context.signal })
        if (!response.ok)
          throw new ProviderError('unavailable', `结果下载失败：HTTP ${response.status}`)
        data = new Uint8Array(await response.arrayBuffer())
      }
      if (!data) return output
      const path = join(dir, fileName(tool, index, output))
      await writeFile(path, data)
      const { data: _bytes, ...rest } = output
      return { ...rest, path, bytes: data.byteLength }
    }),
  )
}
