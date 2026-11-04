import { describe, expect, it } from 'vite-plus/test'
import { mediaRequirementProblems } from './media-requirements'
import type { MediaRequirement } from './provider'

const check = (
  requirement: MediaRequirement,
  sample: Parameters<typeof mediaRequirementProblems>[1],
): string[] => mediaRequirementProblems(requirement, sample, { title: '示例模型', label: '参考图' })

describe('单侧范围文案', () => {
  it('edgeText 的双边 / 仅下限 / 仅上限三种写法', () => {
    expect(check({ minEdge: 100, maxEdge: 500 }, { width: 50, height: 50 })[0]).toContain(
      '宽高 100–500 像素',
    )
    expect(check({ minEdge: 100 }, { width: 50, height: 50 })[0]).toContain('宽高 不小于 100 像素')
    expect(check({ maxEdge: 500 }, { width: 800, height: 800 })[0]).toContain(
      '宽高 不超过 500 像素',
    )
  })

  it('ratioText 的单侧写法', () => {
    expect(check({ minRatio: 1 }, { width: 100, height: 200 })[0]).toContain('要求宽高比 不小于 1')
    expect(check({ maxRatio: 2 }, { width: 400, height: 100 })[0]).toContain('要求宽高比 不超过 2')
  })

  it('frameRateText 的单侧写法', () => {
    expect(check({ minFrameRate: 30 }, { frameRate: 24 })[0]).toContain('要求 不低于 30 fps')
    expect(check({ maxFrameRate: 30 }, { frameRate: 60 })[0]).toContain('要求 不高于 30 fps')
  })
})

describe('总像素与时长上限', () => {
  it('总像素越界时给出总像素与范围', () => {
    expect(check({ minPixels: 1000000 }, { width: 100, height: 100 })[0]).toContain('总像素 10000')
    expect(check({ maxPixels: 10000 }, { width: 200, height: 200 })[0]).toContain('总像素 40000')
    expect(check({ minPixels: 100, maxPixels: 1000 }, { width: 100, height: 100 })[0]).toContain(
      '要求总像素 100–1000',
    )
  })

  it('时长超过 maxDuration 时给出上限', () => {
    expect(check({ maxDuration: 10 }, { duration: 20 })[0]).toBe(
      '参考图时长 20 秒，超过 示例模型 的 10 秒上限，请换更短的素材',
    )
  })
})
