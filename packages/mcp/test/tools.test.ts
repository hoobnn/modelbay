import { describe, expect, it } from 'vite-plus/test'
import { MCP_TOOL_GROUPS, type MCPTool } from '../src/types'
import { generateTools, listTools, toolNames } from '../src/generate'
import { fakeAdapter, readInventory, MCP_KEYS, type McpKey } from './fixtures'

const EXPECTED_COUNTS: Record<McpKey, number> = {
  ark: 8,
  minimax: 17,
  bailian: 18,
  'doubao-speech': 16,
}

function propertyType(prop: Record<string, unknown>): string {
  if (typeof prop.type === 'string') return prop.type
  if (Array.isArray(prop.anyOf)) return 'anyOf'
  return 'unknown'
}

describe.each(MCP_KEYS)('工具清单快照对照：%s', (platform) => {
  const baseline = readInventory(platform)
  const { adapter } = fakeAdapter()
  const set = generateTools(platform, { adapter })
  const all = listTools(set, MCP_TOOL_GROUPS.all)
  const byName = new Map(all.map((tool) => [tool.name, tool]))

  it(`盘点共 ${EXPECTED_COUNTS[platform]} 个基线工具`, () => {
    expect(baseline).toHaveLength(EXPECTED_COUNTS[platform])
  })

  it('每个基线工具名都在生成的 tools/list 里（G2 能力不缩水）', () => {
    const generated = new Set(all.map((tool) => tool.name))
    const missing = baseline.filter((tool) => !generated.has(tool.name)).map((tool) => tool.name)
    expect(missing).toEqual([])
  })

  it('工具名无重复，且数量不少于基线（允许超出）', () => {
    expect(new Set(all.map((tool) => tool.name)).size).toBe(all.length)
    expect(all.length).toBeGreaterThanOrEqual(baseline.length)
  })

  it('基线 inputSchema 的关键字段都存在且类型一致', () => {
    const problems: string[] = []
    for (const tool of baseline) {
      const generated = byName.get(tool.name)
      if (!generated) {
        problems.push(`${tool.name}: 工具缺失`)
        continue
      }
      const baseProps = tool.inputSchema.properties ?? {}
      const genProps = generated.inputSchema.properties ?? {}
      for (const [key, baseProp] of Object.entries(baseProps)) {
        const genProp = genProps[key]
        if (!genProp) {
          problems.push(`${tool.name}.${key}: 缺失`)
          continue
        }
        const baseType = propertyType(baseProp)
        const genType = propertyType(genProp)
        if (baseType !== genType) {
          problems.push(`${tool.name}.${key}: 类型 ${baseType} -> ${genType}`)
        }
      }
      const baseReq = new Set(tool.inputSchema.required ?? [])
      const genReq = new Set(generated.inputSchema.required ?? [])
      for (const key of baseReq) {
        if (!genReq.has(key)) problems.push(`${tool.name}: required 缺少 ${key}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('annotations 四个 hint 都由能力元数据重新派生（不照抄基线）', () => {
    for (const tool of baseline) {
      const generated = byName.get(tool.name) as MCPTool
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ] as const) {
        expect(typeof generated.annotations[hint]).toBe('boolean')
      }
    }
  })

  it('超出基线的新工具 list_declared_models 存在', () => {
    expect(byName.has('list_declared_models')).toBe(true)
    expect(byName.get('list_declared_models')?.annotations.readOnlyHint).toBe(true)
  })

  it('所有工具名都符合 MCP 客户端的约束 ^[a-zA-Z0-9_-]{1,64}$（Claude 拒绝带冒号的名字）', () => {
    const invalid = all.filter((tool) => !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))
    expect(invalid.map((tool) => tool.name)).toEqual([])
  })
})

describe('annotations 修正与跨平台统一', () => {
  it('基线里缺 destructiveHint 的条目，生成结果四个 hint 齐全', () => {
    const minimaxBaseline = readInventory('minimax')
    const missingInBaseline = minimaxBaseline.filter(
      (tool) => tool.annotations && !('destructiveHint' in tool.annotations),
    )
    expect(missingInBaseline.length).toBeGreaterThan(0)
    const { adapter } = fakeAdapter()
    const set = generateTools('minimax', { adapter })
    const byName = new Map(listTools(set, MCP_TOOL_GROUPS.all).map((tool) => [tool.name, tool]))
    for (const tool of missingInBaseline) {
      const generated = byName.get(tool.name) as MCPTool
      expect(Object.keys(generated.annotations).sort()).toEqual(
        ['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint'].sort(),
      )
    }
  })

  it('破坏性/管理工具的 destructiveHint 为 true', () => {
    const { adapter } = fakeAdapter()
    const byName = new Map(
      listTools(generateTools('doubao-speech', { adapter }), MCP_TOOL_GROUPS.all).map((tool) => [
        tool.name,
        tool,
      ]),
    )
    for (const name of ['manage_word_table', 'speech_console']) {
      expect(byName.get(name)?.annotations.destructiveHint).toBe(true)
    }
  })

  it('跨平台同名工具（chat / generate_image / generate_video / get_job）的 annotations 一致', () => {
    const { adapter } = fakeAdapter()
    const names = ['chat', 'generate_image', 'generate_video', 'get_job']
    const snapshots: Record<string, string> = {}
    for (const platform of MCP_KEYS) {
      const byName = new Map(
        listTools(generateTools(platform, { adapter }), MCP_TOOL_GROUPS.all).map((tool) => [
          tool.name,
          tool,
        ]),
      )
      for (const name of names) {
        const tool = byName.get(name)
        if (!tool) continue
        const snapshot = JSON.stringify(tool.annotations)
        if (snapshots[name]) expect(snapshot).toBe(snapshots[name])
        else snapshots[name] = snapshot
      }
    }
    expect(Object.keys(snapshots).length).toBeGreaterThan(0)
  })
})

describe('工具组开关 MCP_TOOL_GROUPS', () => {
  it('默认只暴露 core，可选组默认不启用', () => {
    expect(MCP_TOOL_GROUPS.default).toEqual(['core'])
    expect(MCP_TOOL_GROUPS.optional).toEqual(['realtime', 'management', 'node'])
    const { adapter } = fakeAdapter()
    for (const platform of MCP_KEYS) {
      const set = generateTools(platform, { adapter })
      const optional = set.all.filter((tool) => tool.group !== 'core').map((tool) => tool.name)
      const defaultNames = new Set(toolNames(set, MCP_TOOL_GROUPS.default))
      for (const name of optional) expect(defaultNames.has(name)).toBe(false)
    }
  })

  it('启用全部组后基线工具一个不少', () => {
    const { adapter } = fakeAdapter()
    for (const platform of MCP_KEYS) {
      const baseline = readInventory(platform)
      const names = new Set(toolNames(generateTools(platform, { adapter }), MCP_TOOL_GROUPS.all))
      for (const tool of baseline) expect(names.has(tool.name)).toBe(true)
    }
  })

  it('实时会话 / 管理 / node 组确实落在可选组里', () => {
    const { adapter } = fakeAdapter()
    const doubao = generateTools('doubao-speech', { adapter })
    expect(doubao.byName.get('speech_console')?.group).toBe('management')
    expect(doubao.byName.get('manage_word_table')?.group).toBe('management')
    const minimax = generateTools('minimax', { adapter })
    expect(minimax.byName.get('upload_file')?.group).toBe('node')
  })
})

describe('MiniMax 使用跨平台统一工具名', () => {
  it('只注册统一名，每个能力一个工具', () => {
    const { adapter } = fakeAdapter()
    const set = generateTools('minimax', { adapter })
    const names = new Set(toolNames(set, MCP_TOOL_GROUPS.all))
    for (const unified of ['text_to_speech', 'generate_image', 'clone_voice', 'design_voice']) {
      expect(names.has(unified)).toBe(true)
    }
    for (const legacy of ['text_to_audio', 'text_to_image', 'voice_clone', 'voice_design']) {
      expect(names.has(legacy)).toBe(false)
    }
  })
})
