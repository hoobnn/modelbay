/**
 * 平台适配器契约：适配层只写各家不同的部分（鉴权、路由、请求和响应映射、错误码映射），
 * 通用能力都从 core 注入。MCP 生成器和 modelbay 汇总入口只依赖这个接口。
 */
import type { Capability, CapabilityInput, PollResult, SubmitResult } from './provider'
import type { ModelDeclaration } from './declarations'
import type { AssetSource, JobStore, ModelbayHooks } from './runtime'
import type { NormalizedCapability } from './capabilities'

export interface AdapterRequest<C extends Capability = Capability> {
  capability: C
  /** `渠道:渠道内ID`，也接受规范 ID / 别名 / 简称，由 core 解析 */
  model: string
  input: CapabilityInput<C>
  /** 单平台独有的能力 */
  native?: { op: string; params: Record<string, unknown> }
}

export interface AdapterContext {
  fetch: typeof fetch
  signal: AbortSignal
  secret(name: string): string | undefined
  hooks?: ModelbayHooks
  assets?: AssetSource
  jobs?: JobStore
  log(message: string, data?: Record<string, unknown>): void
}

export interface PlatformAdapter {
  /** `vendor/name` */
  id: string
  title: string
  channels: string[]
  models: ModelDeclaration[]
  nativeOperations?: string[]
  docsUrl?: string
  submit(request: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult>
  poll?(remoteId: string, ctx: AdapterContext): Promise<PollResult>
  cancel?(remoteId: string, ctx: AdapterContext): Promise<void>
  native?(op: string, params: Record<string, unknown>, ctx: AdapterContext): Promise<unknown>
  /** 可选子路径能力：只在 Node 下可用，默认不暴露给 MCP */
  nodeOnly?: string[]
}

const NAMESPACED = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/

export function defineAdapter(def: PlatformAdapter): PlatformAdapter {
  if (!NAMESPACED.test(def.id)) throw new Error(`Adapter id ${def.id} 应为 vendor/name`)
  if (def.channels.length === 0) throw new Error(`Adapter ${def.id} 至少要有一个渠道`)
  const ids = new Set<string>()
  for (const model of def.models) {
    if (ids.has(model.canonicalId)) {
      throw new Error(`Adapter ${def.id} 的模型 ${model.canonicalId} 重复`)
    }
    ids.add(model.canonicalId)
  }
  return def
}

export interface AdapterContextOptions {
  fetchImpl?: typeof fetch
  secrets?: Record<string, string>
  signal?: AbortSignal
  hooks?: ModelbayHooks
  assets?: AssetSource
  jobs?: JobStore
  log?(message: string, data?: Record<string, unknown>): void
}

export function createAdapterContext(options: AdapterContextOptions = {}): AdapterContext {
  return {
    fetch: options.fetchImpl ?? fetch,
    signal: options.signal ?? new AbortController().signal,
    secret: (name) => options.secrets?.[name],
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.jobs ? { jobs: options.jobs } : {}),
    log: options.log ?? (() => {}),
  }
}

/** 适配器能力查询：给汇总入口和 MCP 生成器用 */
export function adapterCapabilities(adapter: PlatformAdapter): NormalizedCapability[] {
  const all = new Set<NormalizedCapability>()
  for (const model of adapter.models) {
    for (const capability of model.capabilities) all.add(capability)
  }
  return [...all]
}
