/**
 * 声明驱动的回归测试：改一份声明（内存里），生成的工具 schema 与说明必须跟着变。
 *
 * 这是 G1「一处修改，处处生效」在 MCP 侧的守卫：
 * 工具的 model 取值、默认值、时长 / 分辨率等上下限、说明里的模型清单，
 * 全部来自 `ModelDeclaration`，不来自 `docs/inventory/*.json` 的快照。
 */
import { describe, expect, it } from 'vite-plus/test'
import type { ModelDeclaration } from '@modelbay/core'
import { generateTools } from '../src/generate'
import { MCP_TOOL_GROUPS } from '../src/types'
import { loadCatalog } from '../src/catalog/index'
import { fakeModels } from './fixtures'

/** 造一份视频模型声明，范围与默认值由参数决定，方便测试里改。 */
function videoModel(options: {
  id: string
  duration: { min: number; max: number }
  resolutions: string[]
  defaultResolution: string
  status?: 'active' | 'retired' | 'superseded'
  /** 是否是默认模型（默认模型只能靠声明显式标记）。 */
  isDefault?: boolean
}): ModelDeclaration {
  const source = { url: 'https://example.test/docs/video', checkedAt: '2026-11-05' }
  return {
    id: options.id,
    title: options.id,
    canonicalId: `fake/${options.id}`,
    capabilities: ['video.generate'],
    channels: [{ channel: 'ark', id: options.id }],
    aliases: { official: [], short: [] },
    limits: {
      duration: options.duration,
      resolutions: options.resolutions,
      defaultResolution: options.defaultResolution,
    },
    lifecycle: {
      status: options.status ?? 'active',
      ...(options.status === 'superseded' ? { by: 'fake/other' } : {}),
      source,
    },
    source,
    ...(options.isDefault ? { default: true as const } : {}),
  } as ModelDeclaration
}

function videoTool(models: readonly ModelDeclaration[]) {
  const set = generateTools('ark', { models })
  const tool = set.byName.get('generate_video')
  if (!tool) throw new Error('generate_video 工具缺失')
  return tool
}

describe('工具 schema 由声明派生', () => {
  const base = videoModel({
    id: 'video-a',
    duration: { min: 4, max: 30 },
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    isDefault: true,
  })

  it('model 的默认值来自声明，不是写死的', () => {
    const tool = videoTool([base])
    expect(tool.inputSchema.properties?.model?.default).toBe('ark:video-a')
  })

  it('改声明里的时长上限，生成的 duration 约束跟着变', () => {
    const before = videoTool([base])
    const after = videoTool([
      {
        ...base,
        limits: { ...base.limits!, duration: { min: 4, max: 60 } },
      } as ModelDeclaration,
    ])
    expect(before.inputSchema.properties?.duration?.maximum).toBe(30)
    expect(after.inputSchema.properties?.duration?.maximum).toBe(60)
  })

  it('改声明里的分辨率档位，生成的 resolution 取值集合跟着变', () => {
    const before = videoTool([base])
    const after = videoTool([
      {
        ...base,
        limits: { ...base.limits!, resolutions: ['480p', '720p', '1080p'] },
      } as ModelDeclaration,
    ])
    expect(before.inputSchema.properties?.resolution?.enum).toEqual(['480p', '720p'])
    expect(after.inputSchema.properties?.resolution?.enum).toEqual(['480p', '720p', '1080p'])
  })

  it('改声明的默认分辨率，生成的默认值跟着变', () => {
    const after = videoTool([
      {
        ...base,
        limits: { ...base.limits!, defaultResolution: '480p' },
      } as ModelDeclaration,
    ])
    expect(after.inputSchema.properties?.resolution?.default).toBe('480p')
  })

  it('把模型状态改成 retired：说明里出现下线提示，默认模型不再选它', () => {
    const retired = {
      ...base,
      lifecycle: { ...base.lifecycle, status: 'retired' as const },
    } as ModelDeclaration
    const tool = videoTool([retired])
    expect(tool.description).toContain('官方已下线')
    expect(tool.inputSchema.properties?.model?.default).not.toBe('ark:video-a')
  })

  it('改声明的可用模型 ID 集合，model 说明里的可选值跟着变', () => {
    const before = videoTool([base])
    const after = videoTool([
      base,
      { ...base, id: 'video-b', canonicalId: 'fake/video-b' } as ModelDeclaration,
    ])
    expect(String(before.inputSchema.properties?.model?.description)).not.toContain('fake/video-b')
    expect(String(after.inputSchema.properties?.model?.description)).toContain('fake/video-b')
  })

  it('说明里的模型清单逐模型列出上限，改声明后清单跟着变', () => {
    const before = videoTool([base])
    const after = videoTool([
      {
        ...base,
        limits: { ...base.limits!, duration: { min: 4, max: 60 } },
      } as ModelDeclaration,
    ])
    expect(before.description).toContain('时长 4–30 秒')
    expect(after.description).toContain('时长 4–60 秒')
  })
})

describe('目录里不含模型相关字面量', () => {
  it('catalog 的 model 字段没有硬编码的模型 ID 默认值', () => {
    for (const platform of ['ark', 'minimax', 'bailian', 'doubao-speech'] as const) {
      for (const entry of loadCatalog(platform)) {
        const model = entry.inputSchema.properties?.model
        if (!model) continue
        // default 只允许 undefined（由声明派生）或 null（不传由平台自己判断）
        expect([undefined, null]).toContain(model.default)
      }
    }
  })

  it('fake 声明派生出的 model 说明里没有基线快照里的占位默认值', () => {
    const set = generateTools('ark', { models: fakeModels })
    const tool = set.byName.get('chat')!
    expect(tool.inputSchema.properties?.model?.default).toBe('ark:chat-pro')
    expect(tool.description).toContain('可用模型（由声明派生）')
  })

  it('全部工具组下工具名仍然合法', () => {
    for (const platform of ['ark', 'minimax', 'bailian', 'doubao-speech'] as const) {
      const set = generateTools(platform, { models: fakeModels })
      for (const tool of set.all) {
        expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      }
    }
    expect(MCP_TOOL_GROUPS.all.length).toBeGreaterThan(0)
  })
})
