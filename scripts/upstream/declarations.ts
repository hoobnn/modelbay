/**
 * 读取已声明的模型，并把对账结果写回成可审阅的改动：
 * - 生命周期补丁直接改声明文件（只改 `lifecycle` 块，附官方原文引用作为注释）；
 * - 未声明的模型生成声明骨架（不登记进 `all`，由人补齐后再加）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelDeclaration } from '@modelbay/core'
import { PLATFORMS } from '../../packages/modelbay/src/platforms'
import type { DeclaredModel, LifecycleGap, UndeclaredGap } from './audit'

export const ROOT = join(import.meta.dirname, '..', '..')

export function modelsDir(platform: string): string {
  return join(ROOT, 'packages', platform, 'src', 'models')
}

/** 注册表里某个平台的全部声明（按 canonicalId 去重）。 */
export function loadDeclarations(platform: string): ModelDeclaration[] {
  const descriptor = PLATFORMS.find((item) => item.key === platform)
  if (!descriptor) throw new Error(`注册表里没有平台：${platform}`)
  const seen = new Map<string, ModelDeclaration>()
  for (const adapter of descriptor.createAdapters()) {
    for (const declaration of adapter.models) seen.set(declaration.canonicalId, declaration)
  }
  return [...seen.values()]
}

export function platformKeys(): string[] {
  return PLATFORMS.map((item) => item.key)
}

export function toDeclared(declaration: ModelDeclaration): DeclaredModel {
  const sources = [
    declaration.source.url,
    declaration.lifecycle.source.url,
    ...declaration.channels.flatMap((ref) => (ref.source ? [ref.source.url] : [])),
  ]
  return {
    canonicalId: declaration.canonicalId,
    id: declaration.id,
    title: declaration.title,
    capabilities: [...declaration.capabilities],
    channels: declaration.channels.map((ref) => ({ channel: ref.channel, id: ref.id })),
    aliases: [...(declaration.aliases.official ?? []), ...(declaration.aliases.short ?? [])],
    status: declaration.lifecycle.status,
    ...(declaration.lifecycle.sunsetOn ? { sunsetOn: declaration.lifecycle.sunsetOn } : {}),
    lifecycleSource: declaration.lifecycle.source.url,
    sources: [...new Set(sources)],
  }
}

/** 按 canonicalId 找声明文件。 */
export function declarationFile(platform: string, canonicalId: string): string | null {
  const dir = modelsDir(platform)
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue
    const path = join(dir, name)
    if (readFileSync(path, 'utf8').includes(`canonicalId: '${canonicalId}'`)) return path
  }
  return null
}

/** 找到 `lifecycle: {` 开始到配对的 `},` 结束的区间。 */
function lifecycleRange(source: string): { start: number; end: number; indent: string } | null {
  const match = /^([ \t]*)lifecycle: \{/m.exec(source)
  if (!match) return null
  let depth = 0
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const end = source[index + 1] === ',' ? index + 2 : index + 1
        return { start: match.index, end, indent: match[1]! }
      }
    }
  }
  return null
}

const singleQuoted = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** 把生命周期补丁写进声明文件，返回改动的文件路径。 */
export function applyLifecycle(platform: string, gap: LifecycleGap, today: string): string {
  const path = declarationFile(platform, gap.canonicalId)
  if (!path) throw new Error(`找不到声明文件：${gap.canonicalId}`)
  writeFileSync(path, patchLifecycle(readFileSync(path, 'utf8'), gap, today))
  return path
}

/** 替换声明源码里的 `lifecycle` 块，前面加一行官方原文引用。 */
export function patchLifecycle(source: string, gap: LifecycleGap, today: string): string {
  const range = lifecycleRange(source)
  if (!range) throw new Error(`声明里没有 lifecycle 块：${gap.canonicalId}`)
  const pad = range.indent
  const quote = gap.evidence[0]!.quote.replace(/\s+/g, ' ').slice(0, 160)
  const inline = `${pad}  source: { url: ${singleQuoted(gap.proposed.source)}, checkedAt: '${today}' },`
  const sourceLines =
    inline.length <= 100
      ? [inline]
      : [
          `${pad}  source: {`,
          `${pad}    url: ${singleQuoted(gap.proposed.source)},`,
          `${pad}    checkedAt: '${today}',`,
          `${pad}  },`,
        ]
  const block = [
    `${pad}// 官方原文（${today}）：${quote}`,
    `${pad}lifecycle: {`,
    `${pad}  status: '${gap.proposed.status}',`,
    ...(gap.proposed.sunsetOn ? [`${pad}  sunsetOn: '${gap.proposed.sunsetOn}',`] : []),
    ...sourceLines,
    `${pad}},`,
  ].join('\n')
  return source.slice(0, range.start) + block + source.slice(range.end)
}

/** 未声明模型的骨架：页面能确定的字段填好，其余标 TODO。 */
export function skeleton(gap: UndeclaredGap, vendor: string, today: string): string {
  const capability = gap.capability?.startsWith('native:') ? undefined : gap.capability
  const native = gap.capability?.startsWith('native:') ? gap.capability.slice(7) : undefined
  return [
    `import type { ModelDeclaration } from '@modelbay/core'`,
    ``,
    `// 由上游文档对账生成（${today}）。核对能力、上下限、默认值后再登记进 index.ts 的 all。`,
    `// 出处：${gap.evidence.section || gap.evidence.url}`,
    `export default {`,
    `  canonicalId: ${singleQuoted(`${vendor}/${gap.id}`)},`,
    `  id: ${singleQuoted(gap.id)},`,
    `  title: ${singleQuoted(gap.id)},`,
    `  capabilities: [${capability ? singleQuoted(capability) : '/* TODO */'}],`,
    ...(native ? [`  native: [${singleQuoted(native)}],`] : []),
    `  channels: [{ channel: ${singleQuoted(gap.channel)}, id: ${singleQuoted(gap.id)} }],`,
    `  aliases: { official: [], short: [] },`,
    `  lifecycle: {`,
    `    status: 'active',`,
    `    source: { url: ${singleQuoted(gap.evidence.url)}, checkedAt: '${today}' },`,
    `  },`,
    `  source: { url: ${singleQuoted(gap.evidence.url)}, checkedAt: '${today}' },`,
    `} satisfies ModelDeclaration`,
    ``,
  ].join('\n')
}

/** 平台里最常见的 canonicalId 厂商段，作为骨架的默认厂商。 */
export function defaultVendor(declarations: ModelDeclaration[]): string {
  const counts = new Map<string, number>()
  for (const declaration of declarations) {
    const vendor = declaration.canonicalId.split('/')[0]!
    counts.set(vendor, (counts.get(vendor) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'vendor'
}

/** 离线检查：每个声明的来源都是白名单里的官方 https 地址，并带核对日期。 */
export function coverageProblems(
  declarations: ModelDeclaration[],
  isOfficial: (url: string) => boolean,
): string[] {
  const problems: string[] = []
  const date = /^\d{4}-\d{2}-\d{2}$/
  for (const declaration of declarations) {
    const sources = [
      ['source', declaration.source],
      ['lifecycle.source', declaration.lifecycle.source],
      ...declaration.channels.flatMap((ref) =>
        ref.source ? [[`channels[${ref.channel}].source`, ref.source] as const] : [],
      ),
    ] as const
    for (const [field, source] of sources) {
      if (!source?.url || !isOfficial(source.url)) {
        problems.push(`${declaration.canonicalId}: ${field}.url 不是白名单里的官方 https 地址`)
      }
      if (!source?.checkedAt || !date.test(source.checkedAt)) {
        problems.push(`${declaration.canonicalId}: ${field}.checkedAt 应为 YYYY-MM-DD`)
      }
    }
  }
  return problems
}
