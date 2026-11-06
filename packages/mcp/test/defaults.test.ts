/**
 * 默认模型的回归测试：四个 MCP 里每个带 `model` 字段的工具，默认值必须等于预期表。
 *
 * 预期表与工具清单快照（`test/baselines/*.json`）里各工具 `model` 字段的 `default` 一致：
 * - 方舟 chat 的 `pro` → `doubao-seed-2-1-pro-260915`（按量渠道，不是套餐渠道）；
 * - 百炼 chat 的 `max` → `qwen3.8-max`，生图的 `qwen` → `qwen-image-3.0-pro`，
 *   视频的 `wan` → `wan3.0-video`；
 * - MiniMax 音乐生成的默认是 `music-3.0`，但它已是 `closed-to-new-accounts`，
 *   按 0003 非 active 不能当默认，所以不给默认值，必须显式传。
 */
import { describe, expect, it } from 'vite-plus/test'
import { canBeDefault, type ModelDeclaration } from '@modelbay/core'
import { generateTools } from '../src/generate'
import type { PlatformAdapter } from '@modelbay/core'
import { arkAdapter } from '@modelbay/ark'
import { bailianAdapter } from '@modelbay/bailian'
import { doubaoAdapter } from '@modelbay/doubao-speech'
import { minimaxAdapter } from '@modelbay/minimax'
import { type McpKey, platformOf } from './fixtures'

const ADAPTERS: Record<McpKey, PlatformAdapter> = {
  ark: arkAdapter,
  minimax: minimaxAdapter,
  bailian: bailianAdapter,
  'doubao-speech': doubaoAdapter,
}

/** 每个平台每个带 model 字段的工具的预期默认值；undefined = 不给默认值。 */
const EXPECTED: Record<McpKey, Record<string, string | null | undefined>> = {
  ark: {
    chat: 'ark:doubao-seed-2-1-pro-260915',
    embed: undefined,
    generate_image: 'ark:doubao-seedream-5-0-pro-260628',
    generate_video: 'ark:doubao-seedance-2-5-260628',
  },
  minimax: {
    generate_video: 'minimax:MiniMax-H3',
    list_video_tasks: null,
    music_generation: undefined,
    text_to_speech: 'minimax:speech-2.8-hd',
    generate_image: 'minimax:image-01',
    clone_voice: 'minimax:speech-2.8-hd',
  },
  bailian: {
    chat: 'bailian:qwen3.8-max',
    edit_video: 'bailian:happyhorse-1.0-video-edit',
    embed: 'bailian:text-embedding-v4',
    generate_image: 'bailian:qwen-image-3.0-pro',
    generate_video: 'bailian:wan3.0-video',
    rerank: 'bailian:qwen3.7-text-rerank',
    speech_to_text: 'bailian:qwen3-asr-flash',
    text_to_speech: null,
  },
  'doubao-speech': {
    generate_audio: 'doubao-speech:seed-audio-1.0',
    text_to_speech: null,
  },
}

function toolDefaults(platform: McpKey): Record<string, unknown> {
  const set = generateTools(platform, { adapter: ADAPTERS[platform] })
  const out: Record<string, unknown> = {}
  for (const tool of set.all) {
    const model = tool.inputSchema?.properties?.model
    if (!model) continue
    out[tool.name] = model.default
  }
  return out
}

describe('MCP 工具的 model 默认值', () => {
  for (const platform of Object.keys(EXPECTED) as McpKey[]) {
    it(`${platform} 的默认值等于预期表`, () => {
      expect(toolDefaults(platform)).toEqual(EXPECTED[platform])
    })
  }

  it('默认值只能落在平台的主渠道里', () => {
    for (const platform of Object.keys(EXPECTED) as McpKey[]) {
      const primary = platformOf(platform).primaryChannel
      for (const [name, value] of Object.entries(toolDefaults(platform))) {
        if (typeof value !== 'string') continue
        expect(`${name}: ${value.split(':')[0]}`).toBe(`${name}: ${primary}`)
      }
    }
  })

  it('默认值不会是非 active 的模型', () => {
    for (const platform of Object.keys(EXPECTED) as McpKey[]) {
      const models = ADAPTERS[platform].models ?? []
      for (const [name, value] of Object.entries(toolDefaults(platform))) {
        if (typeof value !== 'string') continue
        const id = value.split(':')[1] ?? ''
        const declaration = models.find((model: ModelDeclaration) =>
          model.channels.some((channel) => channel.id === id),
        )
        if (!declaration) throw new Error(`${platform}.${name} 的默认模型没有对应声明`)
        expect(canBeDefault(declaration), `${platform}.${name} 的默认模型不是 active`).toBe(true)
      }
    }
  })

  it('没有默认模型的能力，工具说明里说明必须显式传', () => {
    const set = generateTools('minimax', { adapter: minimaxAdapter })
    const tool = set.byName.get('music_generation')
    expect(tool).toBeDefined()
    expect(tool?.description).toContain('model 必须显式指定')
    expect(tool?.description).toContain('music-3.0')
  })
})
