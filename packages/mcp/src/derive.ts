/**
 * inputSchema 的「模型参数部分」全部从这里派生：
 *   - 模型 ID、能力参数、上下限、默认值、生命周期提示
 *     ← ModelDeclaration + capabilityInputSchema() / declarationJsonSchema() / selectDefaultModel() / lifecycleNotice()
 *   - 平台特有字段 ← catalog 里的 inputSchema
 * 本文件不出现任何模型 ID、上下限数值、默认值或生命周期字符串字面量（硬规则）。
 * annotations 也从能力性质（ToolNature）重新派生，不照抄基线。
 */
import {
  capabilityInputSchema,
  declarationJsonSchema,
  lifecycleNotice,
  selectDefaultModel,
} from '@modelbay/core'
import type { ModelDeclaration } from '@modelbay/core'
import type { CatalogEntry, JsonSchema, ToolAnnotations, ToolNature } from './types'

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

export interface ModelParameterPart {
  /** 派生后的 model 字段（替换基线里硬编码的默认值）。 */
  modelField: Record<string, unknown>
  /** 声明 optionsSchema 带来的上下限 / 默认值等属性，只增不覆盖地并入。 */
  optionProperties: Record<string, Record<string, unknown>>
  /** 供文档/测试核对的派生明细。 */
  ids: string[]
  notices: string[]
  defaultModel: string | null
}

/**
 * 用 core 的 schema 函数从声明派生模型参数部分：
 *  - capabilityInputSchema() 给出 model / capability / input 的规范形状（含「渠道:渠道内ID」说明）；
 *  - declarationJsonSchema() 把每个声明的 optionsSchema（上下限、默认值）合并进来；
 *  - selectDefaultModel() 选默认模型（只允许 active），lifecycleNotice() 给生命周期提示。
 */
export function deriveModelParameterPart(
  models: readonly ModelDeclaration[],
  capability: string,
): ModelParameterPart {
  const cap = capability as Capability
  const capSchema = capabilityInputSchema(cap)
  const capProperties = (capSchema.properties ?? {}) as Record<string, Record<string, unknown>>
  // 基线 model 字段的形状与说明来自 core，不在本文件写死
  const baseModel = (capProperties.model ?? { type: 'string' }) as Record<string, unknown>

  const ids: string[] = []
  const notices: string[] = []
  const optionProperties: Record<string, Record<string, unknown>> = {}

  for (const model of models) {
    if (!model.capabilities.includes(cap)) continue
    for (const id of collectModelIds(model)) {
      if (!ids.includes(id)) ids.push(id)
    }
    const notice = lifecycleNotice(model)
    if (notice) notices.push(`${model.canonicalId}：${notice}`)

    const declarationSchema = declarationJsonSchema(model)
    const declarationProperties = (declarationSchema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    for (const [key, value] of Object.entries(declarationProperties)) {
      // model / capability / input / extra 是规范字段，由上面的 capSchema 处理；
      // 其余属性来自声明的 optionsSchema（上下限、默认值等），代码不硬编码。
      if (['model', 'capability', 'input', 'extra'].includes(key)) continue
      if (!(key in optionProperties)) optionProperties[key] = value
    }
  }

  const selected = selectDefaultModel(models, cap)
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

  return { modelField, optionProperties, ids, notices, defaultModel }
}

/** 合并 catalog 的平台特有字段 + 派生的模型参数部分，生成最终 inputSchema。 */
export function deriveInputSchema(
  entry: CatalogEntry,
  models: readonly ModelDeclaration[],
  capability: string,
): JsonSchema {
  const schema = structuredClone(entry.inputSchema)
  const properties = (schema.properties ??= {})
  const { modelField, optionProperties } = deriveModelParameterPart(models, capability)

  if ('model' in properties) {
    // 保留基线 model 的形状（有的工具是 type:string，有的是 anyOf:[string,null]），
    // 只把硬编码的默认值/说明替换成从声明派生出来的值，保证关键字段类型一致。
    const baselineModel = properties.model
    properties.model = {
      ...baselineModel,
      ...(typeof modelField.description === 'string'
        ? { description: modelField.description }
        : {}),
      ...(modelField.default !== undefined ? { default: modelField.default } : {}),
    }
  }
  for (const [key, value] of Object.entries(optionProperties)) {
    // 只增不覆盖：声明里的上下限/默认值不改动基线已有字段的类型，保证关键字段类型一致。
    if (!(key in properties)) properties[key] = structuredClone(value)
  }
  return schema
}
