/**
 * 0003：模型声明格式。声明文件是纯数据，写成
 * `export default { ... } satisfies ModelDeclaration`。
 * 模型身份（canonicalId）和渠道（channels）分开；生命周期带官方来源。
 */
import type { Capability, ModelInfo, ModelLimits, ModelSpec, VoicePreset } from './provider'
import type { NativeOperationName, NormalizedCapability } from './capabilities'

export type LifecycleStatus =
  | 'active'
  | 'superseded'
  | 'sunsetting'
  | 'closed-to-new-accounts'
  | 'retired'

/** 官方文档页与实际读原文的日期 */
export interface ModelSource {
  url: string
  checkedAt: string
}

export interface Lifecycle {
  status: LifecycleStatus
  /** superseded：官方更推荐的型号 */
  by?: string
  /** sunsetting：官方公布的下线日期 */
  sunsetOn?: string
  /** closed-to-new-accounts：限制生效日期 */
  since?: string
  source: ModelSource
}

/** 同一个模型在各渠道里的 ID、端点与覆盖的上限 */
export interface ChannelRef {
  channel: string
  id: string
  endpoint?: string
  limits?: ModelLimits
}

/** 官方别名（同模型的多个官方 ID）与简称（pro / flash / wan） */
export interface ModelAliases {
  official?: string[]
  short?: string[]
}

export interface ModelDeclaration extends Omit<
  ModelSpec,
  'capabilities' | 'deprecated' | 'options'
> {
  /** 规范 ID：厂商/模型，用来去重和跨渠道对比 */
  canonicalId: string
  capabilities: NormalizedCapability[]
  channels: ChannelRef[]
  aliases: ModelAliases
  lifecycle: Lifecycle
  source: ModelSource
  /**
   * 该模型是这项能力的默认模型。
   * 只有 `active` 的模型能带这个标记；`selectDefaultModel()` 优先选它，
   * 没标记时按声明顺序取第一个 active 的。
   * 这样「谁是默认」写在声明数据里，适配器和消费方都不用自己写死。
   */
  default?: true
  /** 模型专属参数的 JSON Schema（声明是纯数据，不写 zod 对象） */
  optionsSchema?: Record<string, unknown>
  /** 只有一家平台有的能力，走 native(op, params) */
  native?: NativeOperationName[]
  voices?: VoicePreset[]
}

export const LIFECYCLE_STATUSES: LifecycleStatus[] = [
  'active',
  'superseded',
  'sunsetting',
  'closed-to-new-accounts',
  'retired',
]

export function isSelectable(model: ModelDeclaration): boolean {
  return model.lifecycle.status !== 'retired'
}

/** 默认模型由 core 统一选，只能选 active 状态 */
export function canBeDefault(model: ModelDeclaration): boolean {
  return model.lifecycle.status === 'active'
}

export function lifecycleNotice(model: ModelDeclaration): string | null {
  const { status, by, sunsetOn, since } = model.lifecycle
  switch (status) {
    case 'superseded':
      return by ? `官方已推荐更新的型号 ${by}` : '官方已推荐更新的型号'
    case 'sunsetting':
      return sunsetOn ? `官方已宣布 ${sunsetOn} 下线` : '官方已宣布即将下线'
    case 'closed-to-new-accounts':
      return since ? `自 ${since} 起不再向新账号开放` : '不再向新账号开放'
    case 'retired':
      return '官方已下线，旧引用可以打开但不能运行'
    default:
      return null
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 声明自检：返回问题列表，空数组表示合法 */
export function validateDeclaration(model: ModelDeclaration): string[] {
  const problems: string[] = []
  if (!model.canonicalId?.includes('/')) problems.push('canonicalId 应为 厂商/模型')
  if (!model.title) problems.push('缺少 title')
  if (model.capabilities.length === 0) problems.push('没有声明能力')
  if (model.channels.length === 0) problems.push('至少要有一个渠道')
  if (!model.source?.url?.startsWith('https://')) problems.push('source.url 缺失或不是 https 链接')
  if (!model.source?.checkedAt || !DATE.test(model.source.checkedAt)) {
    problems.push('source.checkedAt 应为 YYYY-MM-DD')
  }
  if (!model.lifecycle?.source?.url) problems.push('lifecycle.source.url 缺失')
  if (!DATE.test(model.lifecycle?.source?.checkedAt ?? '')) {
    problems.push('lifecycle.source.checkedAt 应为 YYYY-MM-DD')
  }
  if (!LIFECYCLE_STATUSES.includes(model.lifecycle?.status)) problems.push('未知的生命周期状态')
  if (model.lifecycle?.status === 'superseded' && !model.lifecycle.by) {
    problems.push('superseded 需要记录 by')
  }
  if (model.default === true && model.lifecycle?.status !== 'active') {
    problems.push('非 active 模型不能当默认模型')
  }
  for (const channel of model.channels) {
    if (!channel.channel || !channel.id) problems.push('渠道缺少 channel 或 id')
  }
  return problems
}

/** 消费方用 `渠道:渠道内ID` 选模型；也接受规范 ID、官方别名和简称 */
export interface ResolvedModel {
  declaration: ModelDeclaration
  channel: ChannelRef
  /** 用户填的、不在声明里的 ID：只做宽松校验 */
  custom?: string
}

export function resolveModel(
  declarations: readonly ModelDeclaration[],
  ref: string,
): ResolvedModel | null {
  const colon = ref.indexOf(':')
  const channelId = colon >= 0 ? ref.slice(0, colon) : undefined
  const modelId = colon >= 0 ? ref.slice(colon + 1) : ref
  for (const declaration of declarations) {
    for (const channel of declaration.channels) {
      if (channelId !== undefined && channel.channel !== channelId) continue
      const candidates = [
        channel.id,
        declaration.canonicalId,
        ...(declaration.aliases.official ?? []),
        ...(declaration.aliases.short ?? []),
      ]
      if (candidates.includes(modelId) || candidates.includes(ref)) {
        return { declaration, channel }
      }
    }
  }
  return null
}

/** 自定义 ID 透传：只检查和能力相关的通用约束，不查声明 */
export function customModel(ref: string, capability: NormalizedCapability): { custom: string } {
  return { custom: `${capability}:${ref}` }
}

/**
 * 选默认模型：只认声明里显式标了 `default: true` 的 active 模型。
 *
 * 没有标记就没有默认——调用方必须显式传模型，工具说明里给出原因（生命周期提示）。
 * 绝不用「声明顺序第一个 active」兜底：那是隐式约定，会随声明增删而漂移，
 * 也可能挑到非主渠道或非 active 的模型。
 */
export function selectDefaultModel(
  declarations: readonly ModelDeclaration[],
  capability: NormalizedCapability,
  channel?: string,
): ResolvedModel | null {
  const candidates = declarations.filter(
    (declaration) =>
      declaration.default === true &&
      canBeDefault(declaration) &&
      declaration.capabilities.includes(capability),
  )
  for (const declaration of candidates) {
    const found = declaration.channels.find((item) => !channel || item.channel === channel)
    if (found) return { declaration, channel: found }
  }
  return null
}

/**
 * 同一渠道同一能力最多只能有一个默认模型。
 *
 * 返回冲突的「渠道:能力」列表；声明自检与单测都用它。
 */
export function defaultConflicts(declarations: readonly ModelDeclaration[]): string[] {
  const seen = new Map<string, string>()
  const conflicts: string[] = []
  for (const declaration of declarations) {
    if (declaration.default !== true) continue
    for (const channel of declaration.channels) {
      for (const capability of declaration.capabilities) {
        const key = `${channel.channel}:${capability}`
        const owner = seen.get(key)
        if (owner && owner !== declaration.canonicalId) {
          const label = `${key}（${owner} 与 ${declaration.canonicalId}）`
          if (!conflicts.includes(label)) conflicts.push(label)
        } else {
          seen.set(key, declaration.canonicalId)
        }
      }
    }
  }
  return conflicts
}

/** plein 的 ModelInfo 视图：从声明 + 渠道派生，不再由消费方自己写 */
export function toModelInfo(declaration: ModelDeclaration, channel?: ChannelRef): ModelInfo {
  const capabilities = declaration.capabilities.filter((item): item is Capability =>
    isLegacyCapability(item),
  )
  return {
    id: channel?.id ?? declaration.channels[0]?.id ?? declaration.canonicalId,
    title: declaration.title,
    capabilities,
    ...(declaration.description ? { description: declaration.description } : {}),
    ...(declaration.features ? { features: declaration.features } : {}),
    ...(declaration.limits || channel?.limits
      ? { limits: { ...declaration.limits, ...channel?.limits } }
      : {}),
    ...(declaration.voices ? { voices: declaration.voices } : {}),
    ...(declaration.optionsSchema ? { optionsSchema: declaration.optionsSchema } : {}),
    ...(isSelectable(declaration) ? {} : { deprecated: true as const }),
  }
}

function isLegacyCapability(value: string): value is Capability {
  return [
    'text.chat',
    'image.generate',
    'image.edit',
    'image.process',
    'video.generate',
    'audio.speech',
    'audio.music',
    'audio.sfx',
    'audio.transcribe',
  ].includes(value)
}

/** 模型注册表：一处注册，表单、预检、MCP 工具 schema 都从这里派生 */
export class ModelRegistry {
  private readonly declarations: ModelDeclaration[] = []

  add(...models: ModelDeclaration[]): this {
    for (const model of models) {
      const problems = validateDeclaration(model)
      if (problems.length > 0) {
        throw new Error(`模型声明 ${model.canonicalId} 不合法：${problems.join('；')}`)
      }
      this.declarations.push(model)
    }
    return this
  }

  all(): readonly ModelDeclaration[] {
    return this.declarations
  }

  resolve(ref: string): ResolvedModel | null {
    return resolveModel(this.declarations, ref)
  }

  defaultFor(capability: NormalizedCapability, channel?: string): ResolvedModel | null {
    return selectDefaultModel(this.declarations, capability, channel)
  }

  list(capability?: NormalizedCapability, channel?: string): ModelDeclaration[] {
    return this.declarations.filter(
      (model) =>
        (!capability || model.capabilities.includes(capability)) &&
        (!channel || model.channels.some((item) => item.channel === channel)),
    )
  }

  /** 别名冲突检查：一个别名只能指向一个规范 ID */
  aliasConflicts(): string[] {
    const owners = new Map<string, string>()
    const conflicts: string[] = []
    for (const model of this.declarations) {
      for (const alias of [...(model.aliases.official ?? []), ...(model.aliases.short ?? [])]) {
        const owner = owners.get(alias)
        if (owner && owner !== model.canonicalId) conflicts.push(alias)
        else owners.set(alias, model.canonicalId)
      }
    }
    return conflicts
  }
}
