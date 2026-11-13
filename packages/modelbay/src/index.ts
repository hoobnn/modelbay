/**
 * `modelbay` — the single install point for the Modelbay SDK.
 *
 * It re-exports the runtime-agnostic `@modelbay/core` API and the five platform
 * adapter packages. `createModelbay()` wires the adapters into a `ModelRegistry`,
 * resolves default models through core (`defaultFor()`, active only) and drives
 * async jobs through core's `runJob()`, so consumers never write a polling loop
 * of their own (G3).
 *
 * Keys are supplied by the host (options or environment) and never stored or
 * printed by the SDK. Results are URLs or bytes; downloading and persistence
 * belong to the host.
 */
import {
  ModelRegistry,
  ProviderError,
  adapterCapabilities,
  createAdapterContext,
  isSelectable,
  missingSecrets,
  readSecrets,
  runJob,
} from '@modelbay/core'
import type {
  AdapterContext,
  AdapterRequest,
  AssetSource,
  Capability,
  CapabilityInput,
  JobOutcome,
  JobStore,
  ModelbayHooks,
  NormalizedCapability,
  PlatformAdapter,
  PlatformDescriptor,
} from '@modelbay/core'

import * as ark from '@modelbay/ark'
import * as bailian from '@modelbay/bailian'
import * as minimax from '@modelbay/minimax'
import * as doubaoSpeech from '@modelbay/doubao-speech'
import * as openai from '@modelbay/openai'
import { PLATFORMS } from './platforms'

// core 的公共 API 全部再导出：外部项目只装 modelbay 即可用到全部类型与校验函数
export * from '@modelbay/core'

// 平台包以命名空间再导出，消费方可访问各平台特有的导出
export { ark, bailian, minimax, doubaoSpeech, openai }
export { PLATFORMS, findPlatform } from './platforms'

/** 从环境读取所有平台用得到的密钥（含别名与可选配置）。 */
function readEnvSecrets(platforms: readonly PlatformDescriptor[]): Record<string, string> {
  if (typeof process === 'undefined') return {}
  return Object.assign(
    {},
    ...platforms.map((platform) => readSecrets(platform.secrets, process.env)),
  )
}

/**
 * 默认注册的适配器：注册表里每个平台的全部适配器（运行时无关版本）。
 * 需要 Node 专属能力时，用 `modelbay/node` 的 `nodeAdapters()`。
 */
export function defaultAdapters(
  platforms: readonly PlatformDescriptor[] = PLATFORMS,
): PlatformAdapter[] {
  return platforms.flatMap((platform) => platform.createAdapters())
}

/** key 由宿主传入，SDK 不存储；fetch 可注入（夹具测试不联网）。 */
export interface ModelbayOptions {
  /** 覆盖默认注册的适配器；传了就完全用传入的列表 */
  adapters?: readonly PlatformAdapter[]
  /** 显式传入的密钥，键名与适配器 ctx.secret(name) 一致；不传时从环境变量读 */
  secrets?: Record<string, string>
  /** 注入的 fetch，默认全局 fetch；测试用假实现 */
  fetch?: typeof fetch
  hooks?: ModelbayHooks
  store?: JobStore
  assets?: AssetSource
  signal?: AbortSignal
  /** runJob 最长等待时间（毫秒），默认 10 分钟 */
  maxWaitMs?: number
  log?(message: string, data?: Record<string, unknown>): void
}

/** 一次生成请求；不传 model 时由注册表选 active 默认模型。 */
export interface GenerateRequest<C extends Capability = Capability> {
  capability: C
  input: CapabilityInput<C>
  /** 渠道:渠道内ID / 规范 ID / 别名 / 简称；缺省时选默认模型 */
  model?: string
  /** 透传给适配器的单平台独有操作 */
  native?: { op: string; params: Record<string, unknown> }
  signal?: AbortSignal
}

export interface DoctorEntry {
  platform: string
  /** 该平台的必填密钥名（任选一组配齐即可）；只给名字，不给值 */
  names: readonly string[]
  /** 还缺的密钥名；已配置时为空 */
  missing: readonly string[]
  /** `names` 里已配置的那些；只给名字，不给值 */
  present: readonly string[]
  configured: boolean
}

/** doctor 报告：只含配置状态，绝不含密钥值。 */
export interface DoctorReport {
  entries: DoctorEntry[]
  /** 至少有一个平台完整配置 */
  ok: boolean
}

export interface Modelbay {
  /** 模型注册表：默认模型只由 defaultFor() 选（仅 active） */
  readonly registry: ModelRegistry
  readonly adapters: readonly PlatformAdapter[]
  /** 去重后的归一化能力列表 */
  capabilities(): NormalizedCapability[]
  /** 提交 + 轮询由 core 的 runJob() 处理；结果只含 URL 或字节 */
  generate<C extends Capability>(request: GenerateRequest<C>): Promise<JobOutcome>
  /** 检查 key 配置，不打印 key 本身 */
  doctor(): DoctorReport
}

interface Target {
  adapter: PlatformAdapter
  modelRef: string
}

/** 汇总入口：只做再导出与默认注册，不含平台逻辑。 */
export function createModelbay(options: ModelbayOptions = {}): Modelbay {
  const adapters = options.adapters ? [...options.adapters] : defaultAdapters()
  const registry = new ModelRegistry()
  const byChannel = new Map<string, PlatformAdapter>()
  for (const adapter of adapters) {
    registry.add(...adapter.models)
    for (const channel of adapter.channels) byChannel.set(channel, adapter)
  }

  const secrets = options.secrets ?? readEnvSecrets(PLATFORMS)

  function contextFor(signal?: AbortSignal): AdapterContext {
    return createAdapterContext({
      ...(options.fetch ? { fetchImpl: options.fetch } : {}),
      secrets,
      ...(options.hooks ? { hooks: options.hooks } : {}),
      ...(options.assets ? { assets: options.assets } : {}),
      ...(options.store ? { jobs: options.store } : {}),
      signal: signal ?? options.signal,
      ...(options.log ? { log: options.log } : {}),
    })
  }

  function resolveTarget<C extends Capability>(request: GenerateRequest<C>): Target {
    let channel: string
    let modelRef: string

    if (request.model) {
      const resolved = registry.resolve(request.model)
      if (resolved && !isSelectable(resolved.declaration)) {
        // 已归档（retired）的模型不再支持，声明只留作记录
        throw new ProviderError(
          'unavailable',
          `模型 ${request.model} 已归档（官方已下线），不再支持调用`,
        )
      }
      if (resolved) {
        channel = resolved.channel.channel
        // 用渠道内的真实 ID，避免别名/简称在适配器里二次解析
        modelRef = resolved.channel.id
      } else {
        // 自定义 ID：必须写成 渠道:模型ID 才能路由到适配器
        const colon = request.model.indexOf(':')
        if (colon < 0) {
          throw new ProviderError('invalid_input', '自定义模型需要写成「渠道:模型ID」')
        }
        channel = request.model.slice(0, colon)
        modelRef = request.model.slice(colon + 1)
      }
    } else {
      // 默认模型只由 core 选，且只选 active 状态
      const selected = registry.defaultFor(request.capability)
      if (!selected) {
        throw new ProviderError('unavailable', `没有 ${request.capability} 的 active 默认模型`)
      }
      channel = selected.channel.channel
      modelRef = selected.channel.id
    }

    const adapter = byChannel.get(channel)
    if (!adapter) {
      throw new ProviderError('unavailable', `渠道 ${channel} 没有注册适配器`)
    }
    return { adapter, modelRef }
  }

  async function generate<C extends Capability>(request: GenerateRequest<C>): Promise<JobOutcome> {
    const { adapter, modelRef } = resolveTarget(request)
    const ctx = contextFor(request.signal)
    const submitFn = adapter.submit.bind(adapter)
    const pollFn = adapter.poll?.bind(adapter)

    const adapterRequest: AdapterRequest<C> = {
      capability: request.capability,
      model: modelRef,
      input: request.input,
      ...(request.native ? { native: request.native } : {}),
    }

    return runJob({
      platform: adapter.id,
      capability: request.capability,
      submit: () => submitFn(adapterRequest, ctx),
      poll: pollFn ? (remoteId) => pollFn(remoteId, ctx) : undefined,
      hooks: options.hooks,
      store: options.store,
      signal: ctx.signal,
      maxWaitMs: options.maxWaitMs,
    })
  }

  function capabilities(): NormalizedCapability[] {
    const set = new Set<NormalizedCapability>()
    for (const adapter of adapters) {
      for (const capability of adapterCapabilities(adapter)) set.add(capability)
    }
    return [...set].sort()
  }

  function doctor(): DoctorReport {
    const entries: DoctorEntry[] = PLATFORMS.map((platform) => {
      const has = (name: string) => Boolean(secrets[name]?.trim())
      const missing = missingSecrets(platform.secrets, has)
      const names = platform.secrets.required.flat()
      return {
        platform: platform.key,
        names,
        missing,
        present: names.filter(has),
        configured: missing.length === 0,
      }
    })
    return { entries, ok: entries.some((entry) => entry.configured) }
  }

  return { registry, adapters, capabilities, generate, doctor }
}

export * as deepseek from '@modelbay/deepseek'
