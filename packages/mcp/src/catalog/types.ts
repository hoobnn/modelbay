/**
 * 工具目录条目的公共类型与构造辅助。
 *
 * 目录里只放「与模型无关的平台特有部分」：字段形状、平台开关、参数说明。
 * 与模型有关的部分（可选模型 ID、默认值、上下限、生命周期提示）一律在运行时
 * 由 `src/derive.ts` 从 `ModelDeclaration` 派生，见 `ModelParamKind`。
 */
import type { ModelParamKind } from '@modelbay/core'

/** 一条工具定义。 */
export interface CatalogEntry {
  name: string
  description: string
  inputSchema: {
    type?: string
    title?: string
    description?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
    [key: string]: unknown
  }
  outputSchema?: {
    type?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
    [key: string]: unknown
  }
  /**
   * 哪些参数随模型变化，以及它们对应声明里的哪一项上限。
   * 值是 `ModelParamKind`；同一项上限在多个参数上出现时按平台实际语义选一个。
   */
  modelParams?: Record<string, ModelParamKind>
  /** 该工具对应的归一化能力（0003）；用于挑声明和路由 */
  capability?: string
}

/** 可选字符串参数（可为 null） */
export function optionalString(): Record<string, unknown> {
  return { anyOf: [{ type: 'string' }, { type: 'null' }], default: null }
}

/** 可选数字参数（可为 null） */
export function optionalNumber(type: 'integer' | 'number' = 'integer'): Record<string, unknown> {
  return { anyOf: [{ type }, { type: 'null' }], default: null }
}

/** 可选布尔参数（可为 null） */
export function optionalBoolean(): Record<string, unknown> {
  return { anyOf: [{ type: 'boolean' }, { type: 'null' }], default: null }
}

/** 可选数组参数（可为 null） */
export function optionalArray(items: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [{ type: 'array', items }, { type: 'null' }], default: null }
}

/** 可选对象参数（可为 null） */
export function optionalObject(): Record<string, unknown> {
  return {
    anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
    default: null,
  }
}
