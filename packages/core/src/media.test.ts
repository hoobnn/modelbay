import { describe, expect, it } from 'vite-plus/test'
import { overlapping, composeAssetRefs, SUBTITLE_ORIGINS } from './media'
import type { ComposeTransition, ComposeSpec } from './media'
import type { AssetRef } from './ports'

const asset = (id: string): AssetRef => ({ assetId: id, kind: 'image' })

const overlay = (id: string) => ({
  id,
  asset: { assetId: id, kind: 'video' as const },
  start: 0,
  duration: 1,
  in: 0,
  speed: 1,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  opacity: 1,
})

describe('overlapping', () => {
  it('空转场与 fade 不算重叠', () => {
    expect(overlapping(null)).toBe(false)
    expect(overlapping(undefined)).toBe(false)
    expect(overlapping({ type: 'fade', duration: 1 })).toBe(false)
  })

  it('duration 非正的重叠转场也不算', () => {
    const t: ComposeTransition = { type: 'dissolve', duration: 0 }
    expect(overlapping(t)).toBe(false)
    expect(overlapping({ type: 'wipe', duration: -1 })).toBe(false)
  })

  it('非 fade 且 duration 为正的都是重叠转场', () => {
    for (const type of ['dissolve', 'wipe', 'slide', 'flash'] as const) {
      expect(overlapping({ type, duration: 0.5 })).toBe(true)
    }
  })
})

describe('composeAssetRefs', () => {
  it('按 clips、audio、overlays 顺序收集全部资产引用', () => {
    const spec: ComposeSpec = {
      width: 1080,
      height: 1920,
      fps: 30,
      clips: [
        { asset: asset('c1'), in: 0, volume: 1 },
        { asset: asset('c2'), in: 1, volume: 1 },
      ],
      audio: [{ asset: asset('a1'), start: 0, volume: 1 }],
      overlays: [overlay('o1')],
    }
    expect(composeAssetRefs(spec).map((ref) => ref.assetId)).toEqual(['c1', 'c2', 'a1', 'o1'])
  })

  it('没有 overlays 时只收集 clips 和 audio', () => {
    const spec: ComposeSpec = {
      width: 1,
      height: 1,
      fps: 1,
      clips: [{ asset: asset('c1'), in: 0, volume: 1 }],
      audio: [],
    }
    expect(composeAssetRefs(spec).map((ref) => ref.assetId)).toEqual(['c1'])
  })

  it('空合成返回空数组', () => {
    expect(composeAssetRefs({ clips: [], audio: [] })).toEqual([])
  })
})

describe('SUBTITLE_ORIGINS', () => {
  it('字幕来源有固定四类', () => {
    expect(SUBTITLE_ORIGINS).toEqual(['manual', 'estimated', 'asr', 'legacy'])
  })
})
