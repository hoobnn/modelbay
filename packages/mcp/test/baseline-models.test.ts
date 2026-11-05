/**
 * 基线覆盖测试：盘点基线里出现的模型 ID 必须都有声明。
 *
 * `test/baselines/*.json` 是 Python 版 MCP 的工具快照。每个带 `model` 字段的工具，
 * 它的 `default` 与 `enum` 里出现的模型 ID（简称按别名解析）都必须在声明里找得到——
 * 否则要么是漏声明，要么是代码里硬编码了一个没有声明的型号。
 */
import { describe, expect, it } from 'vite-plus/test'
import { arkAdapter } from '@modelbay/ark'
import { bailianAdapter } from '@modelbay/bailian'
import { doubaoAdapter } from '@modelbay/doubao-speech'
import { minimaxAdapter } from '@modelbay/minimax'
import type { ModelDeclaration, PlatformAdapter } from '@modelbay/core'
import { readInventory, MCP_KEYS, type McpKey } from './fixtures'

const ADAPTERS: Record<McpKey, PlatformAdapter> = {
  ark: arkAdapter,
  minimax: minimaxAdapter,
  bailian: bailianAdapter,
  'doubao-speech': doubaoAdapter,
}

/** 一个模型 ID 是否能被声明解析：模型 ID、规范 ID 或任一别名。 */
function resolves(declarations: readonly ModelDeclaration[], id: string): boolean {
  return declarations.some((declaration) => {
    if (declaration.id === id) return true
    if (declaration.canonicalId === id) return true
    if (declaration.channels.some((channel) => channel.id === id)) return true
    return [...(declaration.aliases.official ?? []), ...(declaration.aliases.short ?? [])].includes(
      id,
    )
  })
}

describe('基线里的模型 ID 都有声明', () => {
  for (const platform of MCP_KEYS) {
    it(`${platform}：每个工具 model 字段的 default / enum 都能在声明里找到`, () => {
      const declarations = ADAPTERS[platform].models ?? []
      const missing: string[] = []
      for (const tool of readInventory(platform)) {
        const model = tool.inputSchema?.properties?.model as
          | { default?: unknown; enum?: unknown[] }
          | undefined
        if (!model) continue
        const values: string[] = []
        if (typeof model.default === 'string') values.push(model.default)
        if (Array.isArray(model.enum))
          for (const value of model.enum) if (typeof value === 'string') values.push(value)
        for (const value of values) {
          if (!resolves(declarations, value)) missing.push(`${tool.name}: ${value}`)
        }
      }
      expect(missing).toEqual([])
    })
  }

  it('MCP 独有的模型也有声明（不再藏在适配器代码里）', () => {
    const bailian = bailianAdapter.models ?? []
    // Python 版 MCP 里只有它才有的型号
    for (const id of [
      'z-image-turbo',
      'qwen3-asr-flash',
      'text-embedding-v4',
      'qwen3-vl-embedding',
      'qwen3.7-text-rerank',
      'happyhorse-1.0-video-edit',
      'wan2.2-s2v',
    ]) {
      expect(resolves(bailian, id), `百炼缺少 ${id} 的声明`).toBe(true)
    }
    const minimax = minimaxAdapter.models ?? []
    expect(resolves(minimax, 'music-2.6')).toBe(true)
    const doubao = doubaoAdapter.models ?? []
    expect(resolves(doubao, 'seed-tts-1.0')).toBe(true)
    const ark = arkAdapter.models ?? []
    expect(resolves(ark, 'doubao-embedding-vision')).toBe(true)
  })
})
