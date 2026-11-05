/**
 * 模型专属参数（`optionsSchema`，JSON Schema）的运行期检查。
 *
 * 与宿主的表单读的是同一份声明：类型或枚举不对就在联网前拒绝；
 * 声明之外的键不报错（宿主会混入画幅等通用键），由调用方按 `optionKeys` 取用。
 */
import { z } from 'zod'

type Schema = Record<string, unknown> | undefined

/** 声明里列出的专属参数名。 */
export function optionKeys(schema: Schema): string[] {
  const properties = schema?.properties
  return properties && typeof properties === 'object' ? Object.keys(properties) : []
}

/** 专属参数不符合声明时返回 true；没有声明或 Schema 无法解析时不拦截。 */
export function optionsProblem(schema: Schema, value: Record<string, unknown>): boolean {
  if (!schema) return false
  const keys = optionKeys(schema)
  const picked = Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)))
  try {
    return !z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(picked)
      .success
  } catch {
    return false
  }
}
