import { describe, expect, it } from 'vite-plus/test'
import { imageLimits, imageModelProblem, selectedImageOptions } from './image-input'
import type { ModelInfo, ModelLimits } from './provider'

const base: ModelInfo = { id: 'm', title: '示例图片', capabilities: ['image.generate'] }

describe('selectedImageOptions', () => {
  it('取出 options[model] 里该模型隔离保存的参数对象', () => {
    const params = {
      model: 'volc/ark:seedream',
      options: {
        'volc/ark:seedream': { resolution: '2K' },
        other: { resolution: '1K' },
      },
    }
    expect(selectedImageOptions(params)).toEqual({ resolution: '2K' })
  })

  it('options 不是对象、缺 model 或取出的值不是对象时返回空对象', () => {
    expect(selectedImageOptions({ model: 'x', options: 'nope' })).toEqual({})
    expect(selectedImageOptions({ model: 'x', options: [1, 2] })).toEqual({})
    expect(selectedImageOptions({ model: 'x' })).toEqual({})
    expect(selectedImageOptions({ model: 'x', options: { x: 'text' } })).toEqual({})
    expect(selectedImageOptions({ model: 'x', options: { x: null } })).toEqual({})
    expect(selectedImageOptions({ model: 'x', options: { x: [1] } })).toEqual({})
  })
})

describe('imageLimits 画幅收紧', () => {
  const limits = (): ModelLimits => ({
    aspectRatios: ['16:9', 'auto', '1:1'],
    resolutions: ['1K', '2K'],
    image: { resolutionRequiresAspectRatio: true },
  })

  it('选了分辨率且未用 options.size 时去掉 auto 画幅', () => {
    expect(imageLimits(limits(), { resolution: '2K' }).aspectRatios).toEqual(['16:9', '1:1'])
  })

  it('没选分辨率或带 options.size 时保留原画幅', () => {
    expect(imageLimits(limits(), {}).aspectRatios).toEqual(['16:9', 'auto', '1:1'])
    expect(
      imageLimits(limits(), { resolution: '2K', options: { size: '2K' } }).aspectRatios,
    ).toEqual(['16:9', 'auto', '1:1'])
  })
})

describe('imageModelProblem 的剩余分支', () => {
  it('参考图超过 limits.references.max', () => {
    const model: ModelInfo = { ...base, limits: { references: { max: 2 } } }
    expect(imageModelProblem(model, { count: 1 }, 3)).toBe(
      '示例图片 最多支持 2 张参考图，现在连了 3 张',
    )
  })

  it('参考图与生成图片合计超过 maxTotalImages', () => {
    const model: ModelInfo = { ...base, limits: { image: { maxTotalImages: 3 } } }
    expect(imageModelProblem(model, { count: 2 }, 2)).toBe('示例图片 参考图与生成图片合计最多 3 张')
  })

  it('生成张数超过 limits.count.max', () => {
    const model: ModelInfo = { ...base, limits: { count: { max: 2 } } }
    expect(imageModelProblem(model, { count: 3 }, 0)).toBe('示例图片 一次最多生成 2 张')
  })

  it('画幅不在 aspectRatios 里', () => {
    const model: ModelInfo = { ...base, limits: { aspectRatios: ['16:9', '9:16'] } }
    expect(imageModelProblem(model, { aspectRatio: '4:3' }, 0)).toBe('示例图片 不支持画幅 4:3')
  })

  it('有参考图时命中的 referenceForbiddenOptions', () => {
    const model: ModelInfo = {
      ...base,
      limits: { image: { referenceForbiddenOptions: { quality: ['fast', 'draft'] } } },
    }
    expect(imageModelProblem(model, { options: { quality: 'fast' } }, 1)).toBe(
      '示例图片 有参考图时不支持 quality=fast',
    )
    expect(imageModelProblem(model, { options: { quality: 'high' } }, 1)).toBeNull()
  })

  it('自定义宽高不是正整数时挡住', () => {
    const model: ModelInfo = { ...base, limits: { customSize: { min: 512, max: 2048 } } }
    expect(imageModelProblem(model, { width: 0, height: 512 }, 0)).toBe(
      '示例图片 的自定义宽高须为正整数，现在是 0×512',
    )
    expect(imageModelProblem(model, { width: 'abc', height: 512 }, 0)).toBe(
      '示例图片 的自定义宽高须为正整数，现在是 abc×512',
    )
  })
})
