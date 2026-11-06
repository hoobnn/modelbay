/**
 * 模型专属参数（`optionsSchema`，JSON Schema）的运行期检查：
 * 与 MCP / 宿主表单读的是同一份声明，类型或取值不对就在联网前拒绝。
 */
import { ProviderError, type ModelDeclaration } from '@modelbay/core'
import { z } from 'zod'
import { asJson, type Json } from './http'

/** 声明里列出的专属参数名。 */
export function optionKeys(model: ModelDeclaration | undefined): string[] {
  return Object.keys(asJson(model?.optionsSchema?.properties))
}

/** 只检查声明里列出的键；声明外的键由调用方的白名单处理。 */
export function validateOptions(model: ModelDeclaration | undefined, extra: Json): void {
  if (!model?.optionsSchema) return
  const keys = optionKeys(model)
  const picked = Object.fromEntries(Object.entries(extra).filter(([key]) => keys.includes(key)))
  const result = z.fromJSONSchema(model.optionsSchema).safeParse(picked)
  if (!result.success)
    throw new ProviderError(
      'invalid_input',
      `${model.title} 参数无效：${result.error.issues.map((i) => i.path.join('.')).join('、')}`,
    )
}
