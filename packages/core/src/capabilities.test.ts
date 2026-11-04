import { describe, expect, it } from 'vite-plus/test'
import {
  LEGACY_CAPABILITIES,
  ADDITIONAL_CAPABILITIES,
  NormalizedCapability,
  NORMALIZED_CAPABILITIES,
  isNormalizedCapability,
  NATIVE_OPERATIONS,
  native,
} from './capabilities'

describe('归一化能力', () => {
  it('9 种原有能力 + 4 种新增能力 = 13 种', () => {
    expect(LEGACY_CAPABILITIES).toHaveLength(9)
    expect(ADDITIONAL_CAPABILITIES).toEqual([
      'voice.clone',
      'voice.design',
      'voice.list',
      'text.embed',
    ])
    expect(NORMALIZED_CAPABILITIES).toHaveLength(13)
    expect([...LEGACY_CAPABILITIES, ...ADDITIONAL_CAPABILITIES]).toEqual(NORMALIZED_CAPABILITIES)
  })

  it('NormalizedCapability 接受全部 13 种、拒绝未知值', () => {
    for (const capability of NORMALIZED_CAPABILITIES) {
      expect(NormalizedCapability.safeParse(capability).success).toBe(true)
      expect(isNormalizedCapability(capability)).toBe(true)
    }
    expect(NormalizedCapability.safeParse('bogus').success).toBe(false)
  })

  it('isNormalizedCapability 对普通字符串与近似值返回 false', () => {
    expect(isNormalizedCapability('text.chat')).toBe(true)
    expect(isNormalizedCapability('voice.clone')).toBe(true)
    expect(isNormalizedCapability('bogus')).toBe(false)
    expect(isNormalizedCapability('voice.clone.extra')).toBe(false)
    expect(isNormalizedCapability('')).toBe(false)
  })
})

describe('native 操作', () => {
  it('NATIVE_OPERATIONS 列出单平台独有操作', () => {
    expect(NATIVE_OPERATIONS).toHaveLength(11)
    expect(NATIVE_OPERATIONS).toContain('rerank')
    expect(NATIVE_OPERATIONS).toContain('raw-request')
    expect(NATIVE_OPERATIONS).toContain('digital-human-lipsync')
  })

  it('native 把操作名与参数打包，参数缺省为空对象', () => {
    expect(native('rerank', { topK: 3 })).toEqual({ op: 'rerank', params: { topK: 3 } })
    expect(native('raw-request')).toEqual({ op: 'raw-request', params: {} })
  })
})
