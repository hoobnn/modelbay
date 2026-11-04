import { describe, expect, it } from 'vite-plus/test'
import {
  capabilityInputSchema,
  declarationJsonSchema,
  isValidJsonSchema,
  allCapabilitySchemas,
} from './schema'
import { NORMALIZED_CAPABILITIES } from './capabilities'
import type { NormalizedCapability } from './capabilities'
import type { ModelDeclaration } from './declarations'

const source = { url: 'https://platform.example.com/docs', checkedAt: '2026-11-04' }

const declaration = (): ModelDeclaration => ({
  canonicalId: 'minimax/speech-2.8-hd',
  id: 'speech-2.8-hd',
  title: 'MiniMax Speech 2.8 HD',
  capabilities: ['audio.speech'],
  channels: [{ channel: 'minimax', id: 'speech-2.8-hd' }],
  aliases: { short: ['hd'] },
  lifecycle: { status: 'active', source },
  source,
})

describe('capabilityInputSchema', () => {
  it('13 种能力都生成合法的 object schema', () => {
    for (const capability of NORMALIZED_CAPABILITIES) {
      const schema = capabilityInputSchema(capability)
      expect(isValidJsonSchema(schema)).toBe(true)
      const properties = schema.properties as Record<string, unknown>
      expect(properties).toHaveProperty('model')
      expect(properties).toHaveProperty('capability')
      expect(properties).toHaveProperty('input')
      expect(properties).toHaveProperty('extra')
    }
  })

  it('capability 字段是对应能力的字面量', () => {
    const schema = capabilityInputSchema('text.embed')
    const properties = schema.properties as Record<string, { const?: string }>
    expect(properties.capability?.const).toBe('text.embed')
  })

  it('未知能力没有 input 字段但仍合法', () => {
    const schema = capabilityInputSchema('bogus' as NormalizedCapability)
    const properties = schema.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('input')
    expect(isValidJsonSchema(schema)).toBe(true)
  })
})

describe('declarationJsonSchema', () => {
  it('用主能力、标题与必填字段生成 schema', () => {
    const schema = declarationJsonSchema(declaration())
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.type).toBe('object')
    expect(schema.title).toBe('MiniMax Speech 2.8 HD')
    expect(schema.required).toEqual(['model', 'capability', 'input'])
    expect(schema.additionalProperties).toBe(true)
    expect(isValidJsonSchema(schema)).toBe(true)
  })

  it('合并 optionsSchema 的 properties', () => {
    const model = {
      ...declaration(),
      optionsSchema: { properties: { scale: { type: 'number' } } },
    }
    const properties = declarationJsonSchema(model).properties as Record<string, unknown>
    expect(properties).toHaveProperty('scale')
    expect(properties).toHaveProperty('model')
  })

  it('optionsSchema 没有 properties 时不追加属性', () => {
    const model = { ...declaration(), optionsSchema: {} }
    const properties = declarationJsonSchema(model).properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('scale')
  })

  it('optionsSchema 为 null 或不是对象时忽略', () => {
    const nullOptions = {
      ...declaration(),
      optionsSchema: null as unknown as Record<string, unknown>,
    }
    const stringOptions = {
      ...declaration(),
      optionsSchema: 'str' as unknown as Record<string, unknown>,
    }
    expect(isValidJsonSchema(declarationJsonSchema(nullOptions))).toBe(true)
    expect(isValidJsonSchema(declarationJsonSchema(stringOptions))).toBe(true)
  })

  it('没有能力时 required 只有 model', () => {
    const model = { ...declaration(), capabilities: [] as NormalizedCapability[] }
    expect(declarationJsonSchema(model).required).toEqual(['model'])
  })
})

describe('isValidJsonSchema', () => {
  it('合法的 object schema 返回 true', () => {
    expect(isValidJsonSchema({ type: 'object', properties: {} })).toBe(true)
    expect(isValidJsonSchema(capabilityInputSchema('text.chat'))).toBe(true)
  })

  it('非对象、缺 type 或 properties 返回 false', () => {
    expect(isValidJsonSchema(null)).toBe(false)
    expect(isValidJsonSchema(undefined)).toBe(false)
    expect(isValidJsonSchema('x')).toBe(false)
    expect(isValidJsonSchema(42)).toBe(false)
    expect(isValidJsonSchema({ type: 'string', properties: {} })).toBe(false)
    expect(isValidJsonSchema({ type: 'object' })).toBe(false)
  })

  it('无法序列化的对象返回 false', () => {
    const circular: Record<string, unknown> = { type: 'object', properties: {} }
    circular.self = circular
    expect(isValidJsonSchema(circular)).toBe(false)
  })
})

describe('allCapabilitySchemas', () => {
  it('为全部 13 种能力各生成一份合法 schema', () => {
    const all = allCapabilitySchemas()
    expect(Object.keys(all)).toHaveLength(13)
    expect(Object.keys(all).sort()).toEqual([...NORMALIZED_CAPABILITIES].sort())
    for (const schema of Object.values(all)) {
      expect(isValidJsonSchema(schema)).toBe(true)
    }
  })
})
