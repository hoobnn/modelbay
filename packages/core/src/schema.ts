/** 从声明生成 JSON Schema：表单、预检和 MCP 工具 schema 都从这里派生。 */
import { z } from 'zod'
import { NORMALIZED_CAPABILITIES } from './capabilities'
import type { ModelDeclaration } from './declarations'
import type { NormalizedCapability } from './capabilities'

const CAPABILITY_PARAMS: Record<string, z.ZodType> = {
  'text.chat': z.object({ messages: z.array(z.unknown()) }),
  'image.generate': z.object({ prompt: z.string() }),
  'image.edit': z.object({ image: z.string(), mask: z.string(), prompt: z.string() }),
  'image.process': z.object({ image: z.string(), operation: z.string() }),
  'video.generate': z.object({ prompt: z.string() }),
  'audio.speech': z.object({ text: z.string() }),
  'audio.music': z.object({ prompt: z.string() }),
  'audio.sfx': z.object({ prompt: z.string() }),
  'audio.transcribe': z.object({ audio: z.string() }),
  'voice.clone': z.object({ voiceId: z.string(), sample: z.string() }),
  'voice.design': z.object({ voiceId: z.string(), prompt: z.string() }),
  'voice.list': z.object({}),
  'text.embed': z.object({ input: z.array(z.string()) }),
}

export function capabilityInputSchema(capability: NormalizedCapability): Record<string, unknown> {
  const base = z.object({
    model: z.string().describe('渠道:渠道内模型 ID'),
    capability: z.literal(capability),
    ...(CAPABILITY_PARAMS[capability] ? { input: CAPABILITY_PARAMS[capability] } : {}),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  return z.toJSONSchema(base, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
}

/** 一个声明对应一份可序列化的参数 schema；optionsSchema 由声明数据提供，代码不硬编码 */
export function declarationJsonSchema(model: ModelDeclaration): Record<string, unknown> {
  const primary = model.capabilities[0]
  const base = capabilityInputSchema(primary ?? 'text.chat')
  const properties: Record<string, unknown> = { ...(base.properties as Record<string, unknown>) }
  const options = model.optionsSchema
  if (options && typeof options === 'object') {
    const optionProperties = (options as { properties?: Record<string, unknown> }).properties
    if (optionProperties) Object.assign(properties, optionProperties)
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: model.title,
    properties,
    required: primary ? ['model', 'capability', 'input'] : ['model'],
    additionalProperties: true,
  }
}

/** 声明自检用：schema 必须能序列化，且是合法的 object schema */
export function isValidJsonSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  try {
    const text = JSON.stringify(schema)
    const parsed = JSON.parse(text) as Record<string, unknown>
    return parsed.type === 'object' && typeof parsed.properties === 'object'
  } catch {
    return false
  }
}

export function allCapabilitySchemas(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const capability of NORMALIZED_CAPABILITIES) {
    out[capability] = capabilityInputSchema(capability)
  }
  return out
}
