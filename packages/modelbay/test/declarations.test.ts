/**
 * 声明自检：注册表里全部平台的全部模型声明，都用 core 的真实校验函数检查。
 *
 * - 纯数据：声明文件里没有函数、条件分支或计算值；
 * - 来源：模型、生命周期、渠道三处 source 都是 https 链接 + YYYY-MM-DD 核对日期；
 * - 生命周期合法，非 active 不当默认；同一渠道同一能力最多一个默认；
 * - 别名全局不冲突，也不和任何模型 ID / 渠道 ID 撞名；
 * - optionsSchema 是简单 object schema，每个参数都有 title，能生成合法 JSON Schema。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import {
  declarationJsonSchema,
  defaultConflicts,
  isValidJsonSchema,
  validateDeclaration,
  type ModelDeclaration,
} from '@modelbay/core'
import { PLATFORMS } from '../src/platforms'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const packagesDir = fileURLToPath(new URL('../../', import.meta.url))

interface Entry {
  platform: string
  declaration: ModelDeclaration
}

/** 每个平台取全部适配器里的声明，按规范 ID 去重（同一平台多个渠道共用一份声明）。 */
const entries: Entry[] = PLATFORMS.flatMap((platform) => {
  const seen = new Map<string, ModelDeclaration>()
  for (const adapter of platform.createAdapters()) {
    for (const declaration of adapter.models) seen.set(declaration.canonicalId, declaration)
  }
  return [...seen.values()].map((declaration) => ({ platform: platform.key, declaration }))
})
const all = entries.map((entry) => entry.declaration)

function sourceProblems(where: string, source: { url?: string; checkedAt?: string } | undefined) {
  const problems: string[] = []
  if (!source?.url?.startsWith('https://')) problems.push(`${where}.url 缺失或不是 https`)
  if (!DATE.test(source?.checkedAt ?? '')) problems.push(`${where}.checkedAt 应为 YYYY-MM-DD`)
  return problems
}

function hasZodInternals(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, child]) =>
      ['def', 'innerType', '_zod', 'shape', 'checks', 'entries'].includes(key) ||
      hasZodInternals(child),
  )
}

describe('模型声明自检', () => {
  it('每个 src/models/*.ts 都登记进了平台的 models/index.ts', () => {
    for (const platform of PLATFORMS) {
      const files = readdirSync(`${packagesDir}${platform.key}/src/models/`).filter(
        (name) => name.endsWith('.ts') && name !== 'index.ts',
      )
      const declared = entries.filter((entry) => entry.platform === platform.key)
      expect(declared.length, platform.key).toBe(files.length)
    }
  })

  it('声明文件是纯数据：export default {...} satisfies ModelDeclaration，无函数与分支', () => {
    const problems: string[] = []
    for (const platform of PLATFORMS) {
      const dir = `${packagesDir}${platform.key}/src/models/`
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.ts') || name === 'index.ts') continue
        const text = readFileSync(`${dir}${name}`, 'utf8')
        const code = text
          .replace(/'(?:\\.|[^'\\])*'/g, "''")
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, '')
        if (!/export default \{[\s\S]*\}\s+satisfies\s+ModelDeclaration/.test(text)) {
          problems.push(`${platform.key}/${name}: 必须写成 export default { ... } satisfies`)
        }
        if (/\bfunction\b|\bif\s*\(|=>|\?[^:\n]*:/.test(code)) {
          problems.push(`${platform.key}/${name}: 不允许函数、条件分支或计算值`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('core 的 validateDeclaration 全部通过，三处 source 都齐全', () => {
    const problems: string[] = []
    for (const { declaration: d } of entries) {
      const id = d.canonicalId
      for (const problem of validateDeclaration(d)) problems.push(`${id}: ${problem}`)
      for (const p of sourceProblems('source', d.source)) problems.push(`${id}: ${p}`)
      for (const p of sourceProblems('lifecycle.source', d.lifecycle.source)) {
        problems.push(`${id}: ${p}`)
      }
      for (const channel of d.channels) {
        if (channel.source === undefined) continue
        for (const p of sourceProblems(`渠道 ${channel.channel} source`, channel.source)) {
          problems.push(`${id}: ${p}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('同一渠道同一能力最多一个默认模型', () => {
    expect(defaultConflicts(all)).toEqual([])
  })

  it('别名全局唯一，且不和模型 ID / 渠道 ID 撞名', () => {
    const occupied = new Set<string>()
    for (const d of all) {
      occupied.add(d.id)
      occupied.add(d.canonicalId)
      for (const channel of d.channels) occupied.add(channel.id)
    }
    const owners = new Map<string, string>()
    const problems: string[] = []
    for (const d of all) {
      for (const alias of [...(d.aliases.official ?? []), ...(d.aliases.short ?? [])]) {
        if (occupied.has(alias))
          problems.push(`${d.canonicalId}: 别名 ${alias} 与模型 / 渠道 ID 冲突`)
        const owner = owners.get(alias)
        if (owner && owner !== d.canonicalId) {
          problems.push(`别名 ${alias} 同时属于 ${owner} 和 ${d.canonicalId}`)
        }
        owners.set(alias, d.canonicalId)
      }
    }
    expect(problems).toEqual([])
  })

  it('optionsSchema 是简单 object schema，参数都有 title，能生成合法 JSON Schema', () => {
    const problems: string[] = []
    for (const { declaration: d } of entries) {
      const id = d.canonicalId
      if (!isValidJsonSchema(declarationJsonSchema(d))) problems.push(`${id}: JSON Schema 不合法`)
      const schema = d.optionsSchema as
        | { type?: string; properties?: Record<string, Record<string, unknown>> }
        | undefined
      if (!schema) continue
      if (hasZodInternals(schema)) problems.push(`${id}: optionsSchema 含 zod 内部字段`)
      if (schema.type !== 'object' || !schema.properties) {
        problems.push(`${id}: optionsSchema 应为 { type: 'object', properties }`)
        continue
      }
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (!prop.type) problems.push(`${id}: optionsSchema.${name} 缺少 type`)
        if (typeof prop.title !== 'string') problems.push(`${id}: optionsSchema.${name} 缺少 title`)
      }
    }
    expect(problems).toEqual([])
  })
})
