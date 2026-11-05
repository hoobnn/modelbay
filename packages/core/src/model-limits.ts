/**
 * 0003：把声明里的上限翻译成工具参数能用的东西。
 *
 * 硬规则：模型参数、上下限、默认值只写在声明数据里，代码不硬编码。
 * 这里提供唯一的翻译层：工具目录只声明「哪个属性对应哪一项上限」，
 * 上限的取值、范围和默认值由本模块从 `ModelDeclaration` 派生。
 *
 * 两类产物：
 * - `schema`：落到 JSON Schema 属性上的约束（enum / minimum / maximum / maxLength …）
 * - `text`：中文说明，写进属性说明或工具说明，让调用方知道每个模型的差别
 */
import type { ModelDeclaration } from './declarations'
import type { MediaRequirements, ModelLimits } from './provider'

/** 声明里的上限种类，与工具属性一一对应（由工具目录指定映射关系）。 */
export type ModelParamKind =
  | 'duration'
  | 'resolution'
  | 'aspectRatio'
  | 'count'
  | 'seed'
  | 'speed'
  | 'promptLength'
  | 'references'

/** 一项上限在单个模型上的投影。 */
export interface ModelParamSpec {
  /** 落到 JSON Schema 属性上的约束。 */
  schema: Record<string, unknown>
  /** 一句话中文说明。 */
  text: string
}

function aspectText(ratios: string[]): string {
  return ratios.join('、')
}

/**
 * 单个模型的一项上限。
 *
 * 返回 null 表示这个模型不限制这一项（例如 `duration: false` 表示时长由模型决定）。
 * 返回的 `schema` 里 `enum` 是可选值集合，`default` 是该模型自己声明的默认值。
 */
export function modelParamSpec(
  limits: ModelLimits | undefined,
  kind: ModelParamKind,
): ModelParamSpec | null {
  if (!limits) return null
  switch (kind) {
    case 'duration': {
      const range = limits.duration
      if (!range || typeof range !== 'object') return null
      return {
        schema: { minimum: range.min, maximum: range.max },
        text: `时长 ${range.min}–${range.max} 秒`,
      }
    }
    case 'resolution': {
      const values = limits.resolutions
      if (!values?.length) return null
      const schema: Record<string, unknown> = { enum: [...values] }
      if (limits.defaultResolution) schema.default = limits.defaultResolution
      return { schema, text: `分辨率 ${values.join('/')}` }
    }
    case 'aspectRatio': {
      const values = limits.aspectRatios
      if (!values?.length) return null
      return { schema: { enum: [...values] }, text: `画幅 ${aspectText(values)}` }
    }
    case 'count': {
      const count = limits.count
      if (!count) return null
      return { schema: { maximum: count.max }, text: `一次最多 ${count.max} 张/条` }
    }
    case 'seed': {
      const seed = limits.seed
      if (!seed || typeof seed !== 'object') return null
      return {
        schema: { minimum: seed.min, maximum: seed.max },
        text: `种子 ${seed.min}–${seed.max}`,
      }
    }
    case 'speed': {
      const speed = limits.speed
      if (!speed || typeof speed !== 'object') return null
      return {
        schema: { minimum: speed.min, maximum: speed.max },
        text: `语速 ${speed.min}–${speed.max} 倍`,
      }
    }
    case 'promptLength': {
      const max = limits.promptMaxLength
      if (max === undefined) return null
      return { schema: { maxLength: max }, text: `文本不超过 ${max} 字` }
    }
    case 'references': {
      const references = limits.references
      if (!references) return null
      return {
        schema: { maximum: references.max },
        text: `参考素材最多 ${references.max} 个`,
      }
    }
  }
}

/**
 * 一组模型在同一项上限上的合并结果。
 *
 * `schema` 是各模型约束的并集（取值集合取并集，数值范围取包络），
 * 这样任何模型能接受的值都不会被 schema 挡掉；每个模型的准确范围放在 `perModel` 里。
 */
export interface DerivedModelParam {
  schema: Record<string, unknown>
  /** 模型规范 ID → 该模型在这一项上的说明。 */
  perModel: Record<string, string>
}

export function deriveModelParam(
  declarations: readonly ModelDeclaration[],
  kind: ModelParamKind,
  defaultModelId?: string,
): DerivedModelParam {
  const schema: Record<string, unknown> = {}
  const perModel: Record<string, string> = {}
  const enums = new Set<string>()
  let minimum: number | undefined
  let maximum: number | undefined

  for (const declaration of declarations) {
    const spec = modelParamSpec(declaration.limits, kind)
    if (!spec) continue
    perModel[declaration.canonicalId] = spec.text
    for (const [key, value] of Object.entries(spec.schema)) {
      if (key === 'enum' && Array.isArray(value)) {
        for (const item of value) enums.add(String(item))
      } else if (key === 'minimum' && typeof value === 'number') {
        minimum = minimum === undefined ? value : Math.min(minimum, value)
      } else if (key === 'maximum' && typeof value === 'number') {
        maximum = maximum === undefined ? value : Math.max(maximum, value)
      } else if (key === 'default') {
        // 默认值只认默认模型自己的声明，别的一律不算
        if (declaration.canonicalId === defaultModelId) schema.default = value
      }
    }
  }

  if (enums.size > 0) schema.enum = [...enums]
  if (minimum !== undefined) schema.minimum = minimum
  if (maximum !== undefined) schema.maximum = maximum
  return { schema, perModel }
}

/** 素材要求的摘要：格式、大小、边长、时长。 */
export function mediaRequirementsText(media: MediaRequirements | undefined): string[] {
  if (!media) return []
  const out: string[] = []
  const kinds = ['image', 'frame', 'video', 'audio', 'process'] as const
  const labels: Record<(typeof kinds)[number], string> = {
    image: '参考图',
    frame: '首尾帧',
    video: '参考视频',
    audio: '参考音频',
    process: '原图',
  }
  for (const kind of kinds) {
    const requirement = media[kind]
    if (!requirement) continue
    const parts: string[] = []
    if (requirement.mime?.length) parts.push(`格式 ${requirement.mime.join('/')}`)
    if (requirement.maxMB !== undefined) {
      parts.push(
        requirement.maxMBExclusive
          ? `小于 ${requirement.maxMB} MB`
          : `不超过 ${requirement.maxMB} MB`,
      )
    }
    if (requirement.minEdge !== undefined && requirement.maxEdge !== undefined) {
      parts.push(`宽高 ${requirement.minEdge}–${requirement.maxEdge} 像素`)
    }
    if (requirement.minDuration !== undefined || requirement.maxDuration !== undefined) {
      const from = requirement.minDuration ?? 0
      const to = requirement.maxDuration ?? 0
      parts.push(
        requirement.maxDuration === undefined ? `每段至少 ${from} 秒` : `每段 ${from}–${to} 秒`,
      )
    }
    if (parts.length) out.push(`${labels[kind]}：${parts.join('，')}`)
  }
  return out
}

/** 一个模型的全部上限摘要，写进工具说明里，让调用方看到各模型的差别。 */
export function modelLimitsText(declaration: ModelDeclaration): string {
  const parts: string[] = []
  for (const kind of [
    'duration',
    'resolution',
    'aspectRatio',
    'count',
    'seed',
    'speed',
    'promptLength',
    'references',
  ] as ModelParamKind[]) {
    const spec = modelParamSpec(declaration.limits, kind)
    if (spec) parts.push(spec.text)
  }
  parts.push(...mediaRequirementsText(declaration.limits?.media))
  return parts.join('；')
}
