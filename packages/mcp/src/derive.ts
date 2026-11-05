/**
 * inputSchema 的「模型参数部分」全部从这里派生：
 *   - model 字段的可选 ID、说明、默认值、生命周期提示
 *     ← ModelDeclaration + capabilityInputSchema() / selectDefaultModel() / lifecycleNotice()
 *   - 随模型变化的参数范围（时长、分辨率、画幅、张数、种子、语速、字数上限等）
 *     ← ModelDeclaration.limits（ModelLimits / MediaRequirements）
 *   - 工具说明里的模型清单与各模型的上限
 *
 * 平台特有字段（web_search、out_dir、previous_response_id 等）来自 `src/catalog/*.ts`，
 * 那里是手写的源码，不含任何模型 ID、上下限数值或生命周期字符串。
 * 本文件也不出现这些字面量（AGENTS.md 硬规则）。
 */
import {
  capabilityInputSchema,
  declarationJsonSchema,
  deriveModelParam,
  lifecycleNotice,
  modelLimitsText,
  selectUsableDefaultModel,
  type ModelDeclaration,
  type ModelParamKind,
} from '@modelbay/core'
import type { CatalogEntry } from './catalog/types'
import type { JsonSchema, ToolAnnotations, ToolNature } from './types'

type Capability = Parameters<typeof capabilityInputSchema>[0]

/** annotations 由能力性质派生，四个 hint 一律齐全（修正基线里缺 destructiveHint 的条目）。 */
const ANNOTATIONS_BY_NATURE: Record<ToolNature, ToolAnnotations> = {
  generate: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  query: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  mutate: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  local: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  realtime: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
}

export function deriveAnnotations(nature: ToolNature): ToolAnnotations {
  return { ...ANNOTATIONS_BY_NATURE[nature] }
}

/** 从声明收集可选模型 ID：渠道内 ID、规范 ID、官方别名、简称。 */
function collectModelIds(model: ModelDeclaration): string[] {
  const ids: string[] = []
  const push = (value: string | undefined) => {
    if (value && !ids.includes(value)) ids.push(value)
  }
  push(model.canonicalId)
  for (const channel of model.channels) push(channel.id)
  for (const alias of model.aliases.official ?? []) push(alias)
  for (const alias of model.aliases.short ?? []) push(alias)
  return ids
}

/** 声明里参与这项能力的模型（按声明顺序）。 */
function modelsForCapability(
  models: readonly ModelDeclaration[],
  capability: string,
): ModelDeclaration[] {
  return models.filter((model) => model.capabilities.includes(capability as never))
}

export interface ModelParameterPart {
  /** 派生后的 model 字段（替换基线里硬编码的默认值）。 */
  modelField: Record<string, unknown>
  /** 声明 optionsSchema 带来的上下限 / 默认值等属性，只增不覆盖地并入。 */
  optionProperties: Record<string, Record<string, unknown>>
  /** 随模型变化的参数范围：属性名 → 该属性的约束。 */
  paramProperties: Record<string, Record<string, unknown>>
  /** 供文档/测试核对的派生明细。 */
  ids: string[]
  notices: string[]
  defaultModel: string | null
  /** 每个模型一行的上限摘要。 */
  details: string[]
}

/**
 * 用 core 的 schema 函数从声明派生模型参数部分：
 *  - capabilityInputSchema() 给出 model / capability / input 的规范形状（含「渠道:渠道内ID」说明）；
 *  - declarationJsonSchema() 把每个声明的 optionsSchema（上下限、默认值）合并进来；
 *  - selectDefaultModel() 选默认模型（只允许 active），lifecycleNotice() 给生命周期提示；
 *  - deriveModelParam() 把 ModelLimits / MediaRequirements 里的上限翻译成参数约束。
 */
export function deriveModelParameterPart(
  models: readonly ModelDeclaration[],
  capability: string,
): ModelParameterPart {
  const cap = capability as Capability
  const capSchema = capabilityInputSchema(cap)
  const capProperties = (capSchema.properties ?? {}) as Record<string, Record<string, unknown>>
  // model 字段的形状来自 core，不在本文件写死
  const baseModel = (capProperties.model ?? { type: 'string' }) as Record<string, unknown>

  const ids: string[] = []
  const notices: string[] = []
  const details: string[] = []
  const optionProperties: Record<string, Record<string, unknown>> = {}
  const scoped = modelsForCapability(models, capability)

  for (const model of scoped) {
    for (const id of collectModelIds(model)) {
      if (!ids.includes(id)) ids.push(id)
    }
    const notice = lifecycleNotice(model)
    if (notice) notices.push(`${model.canonicalId}：${notice}`)
    const limits = modelLimitsText(model)
    if (limits) details.push(`${model.canonicalId}：${limits}`)

    // 声明里 optionsSchema 的上下限 / 默认值也并进来（只增不覆盖）。
    const declarationSchema = declarationJsonSchema(model)
    const declarationProperties = (declarationSchema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    for (const [key, value] of Object.entries(declarationProperties)) {
      // model / capability / input / extra 是规范字段，由 capSchema 处理；
      // 其余属性来自声明的 optionsSchema（上下限、默认值等），代码不硬编码。
      if (['model', 'capability', 'input', 'extra'].includes(key)) continue
      if (!(key in optionProperties)) optionProperties[key] = value
    }
  }

  const selected = selectUsableDefaultModel(models, cap)
  const defaultModel = selected ? `${selected.channel.channel}:${selected.channel.id}` : null

  const descriptionParts: (string | undefined)[] = [
    baseModel.description as string | undefined,
    ids.length > 0 ? `可选模型 ID：${ids.join('、')}` : undefined,
    ...notices,
  ]
  const description = descriptionParts.filter((part): part is string => Boolean(part)).join('\n')

  const modelField: Record<string, unknown> = {
    ...baseModel,
    ...(description ? { description } : {}),
    ...(defaultModel ? { default: defaultModel } : {}),
  }

  return {
    modelField,
    optionProperties,
    paramProperties: {},
    ids,
    notices,
    defaultModel,
    details,
  }
}

/**
 * 把声明里的上限翻译成工具参数的约束。
 *
 * 数值型（时长、张数、种子、语速、字数上限）在 schema 里给出并集范围，
 * 这样任何模型能接受的值都不会被挡掉；分辨率、画幅、素材要求这类各模型不同的取值
 * 放在工具说明里逐模型列出。
 */
export function deriveParamProperties(
  models: readonly ModelDeclaration[],
  capability: string,
  modelParams: Record<string, ModelParamKind> | undefined,
): Record<string, Record<string, unknown>> {
  if (!modelParams) return {}
  const scoped = modelsForCapability(models, capability)
  const selected = selectUsableDefaultModel(models, capability as Capability)
  const out: Record<string, Record<string, unknown>> = {}
  for (const [property, kind] of Object.entries(modelParams)) {
    const derived = deriveModelParam(scoped, kind, selected?.declaration.canonicalId)
    if (Object.keys(derived.schema).length > 0) out[property] = derived.schema
  }
  return out
}

/**
 * 生成工具说明里的模型清单：每个模型一行，写它的上限和生命周期提示。
 * 内容全部来自声明，改声明这段文字就跟着变。
 */
export function deriveModelDetails(
  models: readonly ModelDeclaration[],
  capability: string,
): string {
  const scoped = modelsForCapability(models, capability)
  if (!scoped.length) return ''
  const lines = scoped.map((model) => {
    const limits = modelLimitsText(model)
    const notice = lifecycleNotice(model)
    const parts = [model.title, limits, notice].filter(Boolean)
    return `- ${model.canonicalId}：${parts.join('；')}`
  })
  return lines.join('\n')
}

/**
 * 工具的完整说明 = 目录里手写的平台说明 + 运行时派生的模型清单。
 * 模型清单里每个模型一行，带它的上限与生命周期提示。
 */
export function deriveToolDescription(
  base: string,
  models: readonly ModelDeclaration[],
  capability: string,
): string {
  const details = deriveModelDetails(models, capability)
  if (!details) return base
  return `${base}\n可用模型（由声明派生）：\n${details}\n`
}

/** 合并 catalog 的平台特有字段 + 派生的模型参数部分，生成最终 inputSchema。 */
export function deriveInputSchema(
  entry: CatalogEntry,
  models: readonly ModelDeclaration[],
  capability: string,
): JsonSchema {
  const schema = structuredClone(entry.inputSchema) as JsonSchema
  const properties = (schema.properties ??= {})
  const part = deriveModelParameterPart(models, capability)

  if ('model' in properties) {
    // 保留平台定的形状（有的工具是 type:string，有的是 anyOf），
    // 只把硬编码的默认值与说明替换成从声明派生出来的值。
    const baselineModel = properties.model
    properties.model = {
      ...baselineModel,
      ...(typeof part.modelField.description === 'string'
        ? { description: part.modelField.description }
        : {}),
      // 目录里显式写了 default: null 表示「不传由平台/适配器自己判断」，
      // 这种字段不注入派生默认值（例如百炼 TTS 要按音色反推模型）。
      // 没写 default 的才注入声明派生的默认模型。
      ...('default' in baselineModel
        ? {}
        : part.modelField.default !== undefined
          ? { default: part.modelField.default }
          : {}),
    }
  }

  for (const [key, value] of Object.entries(part.optionProperties)) {
    // 只增不覆盖：声明里的上下限属性不改动平台已有字段的类型，保证关键字段类型一致。
    if (!(key in properties)) properties[key] = structuredClone(value)
  }

  for (const [key, value] of Object.entries(
    deriveParamProperties(models, capability, entry.modelParams),
  )) {
    if (!(key in properties)) {
      properties[key] = structuredClone(value)
      continue
    }
    // 已有字段：只补范围约束，不改类型，也不覆盖平台自己的默认值。
    properties[key] = { ...properties[key], ...structuredClone(value) }
  }

  return schema
}
