import { describe, expect, it } from 'vite-plus/test'
import { selectDefaultModel, toModelInfo } from '@modelbay/core'
import { all as allModels } from '../src/models/index'

const idsIn = (channel: string, capability: string) =>
  allModels
    .filter((item) => item.capabilities.includes(capability as never))
    .flatMap((item) => item.channels.filter((ref) => ref.channel === channel).map((ref) => ref.id))

describe('方舟目录顺序', () => {
  it('按量对话模型的顺序固定，宿主默认取第一个', () => {
    expect(idsIn('ark', 'text.chat')).toEqual([
      'doubao-seed-2-1-pro-260628',
      'doubao-seed-2-1-pro-260915',
      'doubao-seed-2-1-lite-260915',
      'doubao-seed-2-1-turbo-260628',
      'doubao-seed-evolving',
      'custom-chat',
    ])
  })

  it('按量图片与视频模型的顺序固定', () => {
    expect(idsIn('ark', 'image.generate')).toEqual([
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-flash-260915',
      'doubao-seedream-5-0-260128',
      'custom-image',
    ])
    expect(idsIn('ark', 'video.generate')).toEqual([
      'doubao-seedance-2-5-260628',
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-mini-260615',
      'custom-video',
    ])
  })

  it('套餐渠道在每个能力内的顺序保持不变', () => {
    expect(idsIn('ark-plan', 'text.chat')).toEqual([
      'ark-code-latest',
      'doubao-seed-2.0-mini',
      'doubao-seed-2.1-lite',
      'doubao-seed-2.1-pro',
      'doubao-seed-evolving',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4.1-flash',
      'deepseek-v4.1-flash-economy',
      'glm-5.3',
      'glm-5.3-flash',
      'kimi-k2.8-preview',
      'kimi-k3',
      'kimi-k3.1-pro',
      'custom-chat',
    ])
  })

  it('MCP 默认模型由 default 标记决定，不受声明顺序影响', () => {
    const defaults = (channel: string, capability: never) =>
      selectDefaultModel(allModels, capability, channel)?.channel.id
    expect(defaults('ark', 'text.chat' as never)).toBe('doubao-seed-2-1-pro-260915')
    expect(defaults('ark', 'image.generate' as never)).toBe('doubao-seedream-5-0-pro-260628')
    expect(defaults('ark', 'video.generate' as never)).toBe('doubao-seedance-2-5-260628')
  })
})

describe('方舟自定义对话模型的渠道差异', () => {
  it('套餐渠道是仅 Agent 的自定义套餐模型，带 tools', () => {
    const custom = allModels.find((item) => item.id === 'custom-chat')!
    const plan = toModelInfo(
      custom,
      custom.channels.find((ref) => ref.channel === 'ark-plan'),
    )
    expect(plan).toMatchObject({
      title: '自定义套餐对话模型',
      features: ['tools', 'structured'],
      agentOnly: true,
    })
    const api = toModelInfo(
      custom,
      custom.channels.find((ref) => ref.channel === 'ark'),
    )
    expect(api).toMatchObject({ title: '自定义对话模型（设置中填写）', features: ['structured'] })
    expect(api.agentOnly).toBeUndefined()
  })
})

describe('Seed Evolving 的套餐渠道说明', () => {
  it('套餐渠道有自己的标题与说明，按量渠道不变', () => {
    const evolving = allModels.find((item) => item.id === 'doubao-seed-evolving')!
    const plan = toModelInfo(
      evolving,
      evolving.channels.find((ref) => ref.channel === 'ark-plan'),
    )
    expect(plan).toMatchObject({
      title: 'doubao-seed-evolving',
      description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
      agentOnly: true,
    })
    const api = toModelInfo(
      evolving,
      evolving.channels.find((ref) => ref.channel === 'ark'),
    )
    expect(api.title).toBe('Doubao Seed Evolving（快速迭代）')
    expect(api.description).toBeUndefined()
  })
})
