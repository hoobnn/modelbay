/**
 * 平台适配器契约：适配层只写各家不同的部分（鉴权、路由、请求和响应映射、错误码映射），
 * 通用能力都从 core 注入。MCP 生成器和 modelbay 汇总入口只依赖这个接口。
 */
import type {
  Capability,
  CapabilityInput,
  LoadedFile,
  PollResult,
  ProviderSocket,
  SubmissionRecord,
  SubmitResult,
} from './provider'
import type { ModelDeclaration } from './declarations'
import type { AssetRef } from './ports'
import type { AssetSource, JobStore, ModelbayHooks } from './runtime'
import type { NormalizedCapability } from './capabilities'

export interface AdapterRequest<C extends Capability = Capability> {
  capability: C
  /** `渠道:渠道内ID`，也接受规范 ID / 别名 / 简称，由 core 解析 */
  model: string
  input: CapabilityInput<C>
  /** 单平台独有的能力 */
  native?: { op: string; params: Record<string, unknown> }
  /** 仅供内置 Agent 使用（如方舟套餐文本模型不对普通画布开放） */
  usage?: 'agent'
  /**
   * 模型来自远端列表（remote-only）而非内置目录：宿主已核对密钥与设置上下文、
   * 平台的覆盖范围声明以及模型类型与能力的匹配；平台侧可据此放开静态目录校验
   */
  remoteOnly?: boolean
}

export interface AdapterContext {
  fetch: typeof fetch
  signal: AbortSignal
  secret(name: string): string | undefined
  hooks?: ModelbayHooks
  assets?: AssetSource
  jobs?: JobStore
  log(message: string, data?: Record<string, unknown>): void
  /**
   * 宿主的非敏感设置（地域、Base URL、业务空间等）：直接透传，
   * 不发明 settings→secret 的字符串编码；缺省表示宿主没有这层配置。
   */
  settings?: Record<string, unknown>
  /** text.chat 边生成边回调文本增量；宿主没要求时为空，平台照常一次返回 */
  stream?(delta: { text: string }): void
  /**
   * 宿主提供的文件读取：带媒体元数据（时长 / 宽高 / 编码），
   * 与 assets 二选一；适配器优先用它，回退到 assets。
   */
  files?: { read(ref: AssetRef): Promise<LoadedFile> }
  /** 这次调用的幂等键；平台支持客户端幂等键或按客户端标识查任务时传给平台 */
  idempotencyKey?: string
  /** 宿主在发送前持久化的关联信息；requestId 不代表平台支持幂等。 */
  submission?: SubmissionRecord
  /** 宿主裁剪域名权限的二进制 WebSocket；信号中止时自动关闭。 */
  socket?(url: string, headers: Record<string, string>): Promise<ProviderSocket>
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
  settings?: Record<string, unknown>
  stream?(delta: { text: string }): void
  files?: { read(ref: AssetRef): Promise<LoadedFile> }
  idempotencyKey?: string
  submission?: SubmissionRecord
  socket?(url: string, headers: Record<string, string>): Promise<ProviderSocket>
}

export function createAdapterContext(options: AdapterContextOptions = {}): AdapterContext {
  return {
    fetch: options.fetchImpl ?? fetch,
    signal: options.signal ?? new AbortController().signal,
    secret: (name) => options.secrets?.[name],
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.jobs ? { jobs: options.jobs } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.stream ? { stream: options.stream } : {}),
    ...(options.files ? { files: options.files } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.submission ? { submission: options.submission } : {}),
    ...(options.socket ? { socket: options.socket } : {}),
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
