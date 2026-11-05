/** Validate model options from the same declaration used by SDK consumers. */
import { ProviderError, type ModelDeclaration } from '@modelbay/core'
import { z } from 'zod'
import { asJson, type Json } from './http'

export function validateOptions(model: ModelDeclaration | undefined, extra: Json): void {
  if (!model?.optionsSchema) return
  const properties = asJson(model.optionsSchema.properties)
  const picked = Object.fromEntries(Object.entries(extra).filter(([key]) => key in properties))
  const result = z.fromJSONSchema(model.optionsSchema).safeParse(picked)
  if (!result.success)
    throw new ProviderError(
      'invalid_input',
      `${model.title} 参数无效：${result.error.issues.map((i) => i.path.join('.')).join('、')}`,
    )
}

/** Use declaration defaults only for fields that the transport must materialize. */
export function optionDefault(model: ModelDeclaration | undefined, key: string): unknown {
  return asJson(asJson(model?.optionsSchema?.properties)[key]).default
}
