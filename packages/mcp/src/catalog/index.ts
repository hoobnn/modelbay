/** 工具目录加载器。数据由 scripts/gen-catalog.mjs 从 docs/inventory/mcp-*.json 生成。 */
import ark from './ark'
import minimax from './minimax'
import bailian from './bailian'
import doubaoSpeech from './doubao-speech'
import type { CatalogEntry, PlatformKey } from '../types'

/**
 * 生成物是纯数据字面量，TS 推断出的窄类型带 optional undefined，和 CatalogEntry[] 不重叠。
 * 先按 readonly unknown[] 接收（宽化赋值，不需要断言），再用运行时校验函数收窄。
 */
const RAW: Record<PlatformKey, readonly unknown[]> = {
  ark,
  minimax,
  bailian,
  'doubao-speech': doubaoSpeech,
}

/** 运行时校验：目录条目必须带 name / description / 对象型 inputSchema。 */
export function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.name !== 'string' || typeof entry.description !== 'string') return false
  if (!isObjectSchema(entry.inputSchema)) return false
  if (entry.outputSchema !== undefined && !isObjectSchema(entry.outputSchema)) return false
  return true
}

function isObjectSchema(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toCatalog(platform: PlatformKey, raw: readonly unknown[]): CatalogEntry[] {
  return raw.map((entry, index) => {
    if (!isCatalogEntry(entry)) {
      throw new Error(`工具目录 ${platform} 第 ${index} 项不是合法的 CatalogEntry`)
    }
    return entry
  })
}

const CATALOGS: Record<PlatformKey, CatalogEntry[]> = {
  ark: toCatalog('ark', RAW.ark),
  minimax: toCatalog('minimax', RAW.minimax),
  bailian: toCatalog('bailian', RAW.bailian),
  'doubao-speech': toCatalog('doubao-speech', RAW['doubao-speech']),
}

export function loadCatalog(platform: PlatformKey): CatalogEntry[] {
  return CATALOGS[platform]
}

/** 深拷贝，避免生成过程修改目录里的基线数据。 */
export function cloneCatalog(platform: PlatformKey): CatalogEntry[] {
  return structuredClone(CATALOGS[platform])
}
