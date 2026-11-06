import { describe, expect, it } from 'vite-plus/test'
import { deriveAnnotations, deriveInputSchema, deriveModelParameterPart } from '../src/derive'
import { generateTools, listTools, toMCPTool, toolNames } from '../src/generate'
import { EXTRA_TOOL_NAMES, deriveMeta, isOptionalGroup } from '../src/tool-meta'
import { MCP_TOOL_GROUPS, TOOL_GROUPS, TOOL_NATURES } from '../src/types'
import { fakeAdapter, fakeModels, MCP_KEYS, toolsOf } from './fixtures'

describe('工具目录解析', () => {
  it('四个平台目录数量与盘点一致（共 60）', () => {
    const counts = MCP_KEYS.map((platform) => toolsOf(platform).length)
    expect(counts).toEqual([8, 17, 19, 16])
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60)
  })

  it('平台工具不声明 outputSchema：结果形状随工具变化，声明了客户端会按它校验', () => {
    for (const key of MCP_KEYS) {
      for (const entry of toolsOf(key)) expect(entry.outputSchema).toBeUndefined()
    }
  })

  it('目录条目只含 name/description/inputSchema（无 annotations）', () => {
    for (const entry of toolsOf('ark')) {
      expect(entry.name).toBeTruthy()
      expect(entry.inputSchema.type).toBe('object')
      expect('annotations' in entry).toBe(false)
    }
  })

  it('生成工具时深拷贝，改生成结果不影响平台包里的工具定义', () => {
    const before = JSON.stringify(toolsOf('ark')[0]?.inputSchema)
    const set = generateTools('ark', { models: fakeModels })
    set.all[0]!.inputSchema.title = 'MUTATED'
    set.all[0]!.inputSchema.properties = {}
    expect(JSON.stringify(toolsOf('ark')[0]?.inputSchema)).toBe(before)
  })
})

describe('工具元数据', () => {
  it('通用工具名约定：归一化能力 / 本地处理器 / 性质', () => {
    expect(deriveMeta('chat').capability).toBe('text.chat')
    expect(deriveMeta('chat').nature).toBe('generate')
    expect(deriveMeta('chat').group).toBe('core')
    expect(deriveMeta('get_tool_help')).toMatchObject({
      localHandler: 'tool-help',
      nature: 'local',
    })
    expect(deriveMeta('get_job')).toMatchObject({ localHandler: 'jobs', nature: 'query' })
    expect(deriveMeta('list_declared_models').nature).toBe('local')
    // 平台独有的工具名不在通用约定里
    expect(deriveMeta('open_realtime_session')).toEqual({ nature: 'generate', group: 'core' })
  })

  it('平台工具定义里的 native / nature / group 优先于通用约定', () => {
    const { adapter } = fakeAdapter()
    const doubao = generateTools('doubao-speech', { adapter })
    expect(doubao.byName.get('manage_word_table')).toMatchObject({
      group: 'management',
      route: { kind: 'native', op: 'hotword-table', nature: 'mutate' },
    })
    const minimax = generateTools('minimax', { adapter })
    expect(minimax.byName.get('upload_file')?.group).toBe('node')
    expect(minimax.byName.get('delete_video_task')?.annotations.destructiveHint).toBe(true)
  })

  it('额外工具表含 list_declared_models', () => {
    expect(EXTRA_TOOL_NAMES).toContain('list_declared_models')
  })

  it('isOptionalGroup 只对 core 为 false', () => {
    expect(isOptionalGroup('core')).toBe(false)
    for (const group of MCP_TOOL_GROUPS.optional) expect(isOptionalGroup(group)).toBe(true)
    expect(TOOL_GROUPS).toEqual(['core', 'realtime', 'management', 'node'])
    expect(TOOL_NATURES).toHaveLength(5)
  })
})

describe('annotations 派生', () => {
  it('每种性质都给出四个 boolean hint', () => {
    for (const nature of TOOL_NATURES) {
      const annotations = deriveAnnotations(nature)
      expect(Object.keys(annotations).sort()).toEqual(
        ['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint'].sort(),
      )
      for (const value of Object.values(annotations)) expect(typeof value).toBe('boolean')
    }
  })

  it('generate 联网、local 不联网、mutate 具破坏性', () => {
    expect(deriveAnnotations('generate').openWorldHint).toBe(true)
    expect(deriveAnnotations('local').openWorldHint).toBe(false)
    expect(deriveAnnotations('local').readOnlyHint).toBe(true)
    expect(deriveAnnotations('mutate').destructiveHint).toBe(true)
  })
})

describe('模型参数部分从声明 + core schema 派生', () => {
  const part = deriveModelParameterPart(fakeModels, 'text.chat')

  it('模型 ID 来自声明的渠道 / 规范 ID / 别名', () => {
    expect(part.ids).toContain('fake/chat-pro')
    expect(part.ids).toContain('chat-pro')
    expect(part.ids).toContain('pro')
    expect(part.ids).toContain('fake/chat-old')
  })

  it('生命周期提示来自 lifecycleNotice（不硬编码）', () => {
    const notices = part.notices.join('\n')
    expect(notices).toContain('官方已推荐更新的型号 fake/chat-pro')
    expect(notices).toContain('2026-12-01')
  })

  it('默认值由 selectDefaultModel 选 active 模型', () => {
    expect(part.defaultModel).toBe('ark:chat-pro')
    expect(part.modelField.default).toBe('ark:chat-pro')
    expect(part.modelField.type).toBe('string')
    expect(String(part.modelField.description)).toContain('fake/chat-pro')
  })

  it('上下限/默认值来自声明 optionsSchema（declarationJsonSchema）', () => {
    expect(part.optionProperties.max_tokens).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 8192,
      default: 2048,
    })
  })
})

describe('deriveInputSchema 合并', () => {
  const entry = toolsOf('ark').find((item) => item.name === 'chat')!
  const schema = deriveInputSchema(entry, fakeModels, 'text.chat')

  it('目录里不写死模型默认值，改用声明派生', () => {
    expect(schema.properties?.model?.type).toBe('string')
    expect(schema.properties?.model?.default).toBe('ark:chat-pro')
    // 目录是手写的平台特有定义，model 的默认值不在里面
    expect(entry.inputSchema.properties?.model?.default).toBeUndefined()
    expect(String(schema.properties?.model?.description)).toContain('fake/chat-pro')
  })

  it('平台特有字段与 required 原样保留、类型一致', () => {
    expect(schema.properties?.prompt?.type).toBe('string')
    expect(schema.properties?.system?.type).toBeUndefined() // anyOf 形态保持
    expect(schema.properties?.system?.anyOf).toBeDefined()
    expect(schema.required).toEqual(['prompt'])
  })

  it('声明里的上下限属性只增不覆盖，不改动基线已有字段类型', () => {
    // 基线 chat 已有 max_tokens（anyOf），声明的 max_tokens 不覆盖它
    expect(schema.properties?.max_tokens?.anyOf).toBeDefined()
    expect(schema.properties?.max_tokens?.maximum).toBeUndefined()
  })
})

describe('generateTools / listTools / toMCPTool', () => {
  it('无 adapter / 无声明时 tools/list 仍可用（回退）', () => {
    const set = generateTools('ark')
    expect(set.all.length).toBeGreaterThan(0)
    expect(listTools(set, MCP_TOOL_GROUPS.all).length).toBeGreaterThanOrEqual(9)
  })

  it('toMCPTool 去掉内部字段（group/route）', () => {
    const set = generateTools('ark', { models: fakeModels })
    const tool = set.all.find((item) => item.name === 'chat')!
    const publicTool = toMCPTool(tool)
    expect(Object.keys(publicTool).sort()).toEqual(
      ['annotations', 'description', 'inputSchema', 'name'].sort(),
    )
    expect('group' in publicTool).toBe(false)
    expect('route' in publicTool).toBe(false)
  })

  it('groups 过滤只放行启用的组', () => {
    const set = generateTools('doubao-speech', { models: fakeModels })
    const coreOnly = toolNames(set, ['core'])
    const all = toolNames(set, MCP_TOOL_GROUPS.all)
    expect(coreOnly.length).toBeLessThan(all.length)
    expect(coreOnly).not.toContain('speech_console')
    expect(all).toContain('speech_console')
  })

  it('adapter.nodeOnly 把对应 native 工具强制归入 node 组', () => {
    const { adapter } = fakeAdapter({ nodeOnly: ['rerank'] })
    const set = generateTools('bailian', { adapter })
    expect(set.byName.get('rerank')?.group).toBe('node')
  })

  it('routes / byName 覆盖全量工具', () => {
    const set = generateTools('minimax', { models: fakeModels })
    expect(set.routes.size).toBe(set.all.length)
    expect(set.byName.size).toBe(set.all.length)
  })
})
