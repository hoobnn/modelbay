import { describe, expect, it } from 'vite-plus/test'
import {
  referenceLabelStyle,
  referenceLabel,
  referenceMediaLabel,
  referenceMediaNumbering,
  referenceNumbering,
} from './reference-tokens'
import type { PortValue } from './ports'

const image = (assetId: string): PortValue => ({ type: 'image', assetId, kind: 'image' })
const video = (assetId: string): PortValue => ({ type: 'video', assetId, kind: 'video' })
const audio = (assetId: string): PortValue => ({ type: 'audio', assetId, kind: 'audio' })
const text = (t: string): PortValue => ({ type: 'text', text: t })
const json = (): PortValue => ({ type: 'json', value: 1 })
const noAssetId = { type: 'image', kind: 'image' } as unknown as PortValue

describe('referenceLabelStyle', () => {
  it('图片生成用 image，MiniMax 视频用 minimax-video，其余用 video', () => {
    expect(referenceLabelStyle('image.generate', 'volc/ark')).toBe('image')
    expect(referenceLabelStyle('image.generate', 'minimax/api')).toBe('image')
    expect(referenceLabelStyle('video.generate', 'minimax/api')).toBe('minimax-video')
    expect(referenceLabelStyle('video.generate', 'volc/ark')).toBe('ark-video')
    expect(referenceLabelStyle('video.generate', 'volc/ark-plan')).toBe('ark-video')
    expect(referenceLabelStyle('video.generate', 'aliyun/bailian')).toBe('bailian-video')
    expect(referenceLabelStyle('video.generate', 'other/api')).toBe('video')
    expect(referenceLabelStyle(undefined, undefined)).toBe('video')
  })
})

describe('referenceLabel', () => {
  it('三种写法分别给出图N / 图片N / @imageN', () => {
    expect(referenceLabel('image', 1)).toBe('图1')
    expect(referenceLabel('image', 3)).toBe('图3')
    expect(referenceLabel('minimax-video', 2)).toBe('图片2')
    expect(referenceLabel('video', 4)).toBe('@image4')
  })
})

describe('referenceMediaLabel', () => {
  it('图片沿用 referenceLabel 的写法', () => {
    expect(referenceMediaLabel('image', 'image', 2)).toBe('图2')
    expect(referenceMediaLabel('minimax-video', 'image', 2)).toBe('图片2')
    expect(referenceMediaLabel('video', 'image', 2)).toBe('@image2')
  })

  it('minimax-video 对视频 / 音频用中文编号', () => {
    expect(referenceMediaLabel('minimax-video', 'video', 1)).toBe('视频1')
    expect(referenceMediaLabel('minimax-video', 'audio', 3)).toBe('音频3')
  })

  it('其余风格对视频 / 音频用 @kindN', () => {
    expect(referenceMediaLabel('video', 'video', 1)).toBe('@video1')
    expect(referenceMediaLabel('video', 'audio', 4)).toBe('@audio4')
    expect(referenceMediaLabel('ark-video', 'image', 1)).toBe('@图片1')
    expect(referenceMediaLabel('ark-video', 'video', 2)).toBe('@视频2')
    expect(referenceMediaLabel('ark-video', 'audio', 3)).toBe('@音频3')
    expect(referenceMediaLabel('bailian-video', 'image', 1)).toBe('图1')
    expect(referenceMediaLabel('bailian-video', 'video', 2)).toBe('视频2')
    expect(referenceMediaLabel('bailian-video', 'audio', 3)).toBe('音频3')
    expect(referenceMediaLabel('image', 'video', 5)).toBe('@video5')
  })
})

describe('referenceMediaNumbering', () => {
  it('按媒体类型分别编号、同类型去重、跳过非媒体与无 assetId 的值', () => {
    const numbering = referenceMediaNumbering('video', [
      image('A'),
      video('V'),
      audio('D'),
      image('B'),
      image('A'),
      text('hi'),
      json(),
      noAssetId,
    ])
    expect(numbering.index('image', 'A')).toBe(1)
    expect(numbering.label('image', 'A')).toBe('@image1')
    expect(numbering.index('image', 'B')).toBe(2)
    expect(numbering.label('image', 'B')).toBe('@image2')
    expect(numbering.label('video', 'V')).toBe('@video1')
    expect(numbering.label('audio', 'D')).toBe('@audio1')
    expect(numbering.index('image', 'missing')).toBeUndefined()
    expect(numbering.label('video', 'missing')).toBeUndefined()
  })

  it('重复的媒体值会占掉编号但保留第一次的号码', () => {
    const numbering = referenceMediaNumbering('minimax-video', [image('A'), image('A'), image('B')])
    expect(numbering.index('image', 'A')).toBe(1)
    expect(numbering.index('image', 'B')).toBe(3)
    expect(numbering.label('image', 'B')).toBe('图片3')
  })

  it('空列表没有任何编号', () => {
    const numbering = referenceMediaNumbering('image', [])
    expect(numbering.index('image', 'x')).toBeUndefined()
    expect(numbering.label('audio', 'x')).toBeUndefined()
  })
})

describe('referenceNumbering', () => {
  it('只给图片编号，跳过非图片与无 assetId 的值', () => {
    const numbering = referenceNumbering('image', [
      image('A'),
      image('B'),
      image('A'),
      text('hi'),
      video('V'),
      noAssetId,
    ])
    expect(numbering.index('A')).toBe(1)
    expect(numbering.label('A')).toBe('图1')
    expect(numbering.index('B')).toBe(2)
    expect(numbering.label('B')).toBe('图2')
    expect(numbering.index('missing')).toBeUndefined()
    expect(numbering.label('missing')).toBeUndefined()
  })

  it('重复图片占号但保留第一次的号码', () => {
    const numbering = referenceNumbering('video', [image('A'), image('A'), image('B')])
    expect(numbering.index('A')).toBe(1)
    expect(numbering.index('B')).toBe(3)
    expect(numbering.label('B')).toBe('@image3')
  })

  it('空列表没有编号', () => {
    const numbering = referenceNumbering('image', [])
    expect(numbering.index('x')).toBeUndefined()
    expect(numbering.label('x')).toBeUndefined()
  })
})
