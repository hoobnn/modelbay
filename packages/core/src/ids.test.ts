import { describe, expect, it } from 'vite-plus/test'
import {
  PLUGIN_API_VERSION,
  NAMESPACED_ID,
  NamespacedId,
  vendorOf,
  nodeKey,
  parseNodeKey,
  modelRef,
  parseModelRef,
} from './ids'

describe('NAMESPACED_ID 与 NamespacedId', () => {
  it('插件 API 版本是语义化版本字符串', () => {
    expect(PLUGIN_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(PLUGIN_API_VERSION).toBe('0.1.3')
  })

  it('接受 vendor/name 全小写格式', () => {
    for (const id of ['plein/mock', 'a/b', 'a-b/c.d', 'volc/ark', '123/abc.def']) {
      expect(NAMESPACED_ID.test(id)).toBe(true)
      expect(NamespacedId.safeParse(id).success).toBe(true)
    }
  })

  it('拒绝大写、缺段、多余斜杠和空白', () => {
    for (const id of [
      'Vendor/name',
      'vendor/',
      '/name',
      'vendor/name/sub',
      'no-slash',
      'vendor name',
      '',
    ]) {
      expect(NAMESPACED_ID.test(id)).toBe(false)
      expect(NamespacedId.safeParse(id).success).toBe(false)
    }
  })
})

describe('vendorOf / nodeKey / parseNodeKey', () => {
  it('vendorOf 取第一个斜杠前的厂商', () => {
    expect(vendorOf('plein/mock')).toBe('plein')
    expect(vendorOf('minimax/api:foo')).toBe('minimax')
    expect(vendorOf('volc/ark:doubao')).toBe('volc')
  })

  it('nodeKey 拼出带版本的类型', () => {
    expect(nodeKey('plein/mock', 2)).toBe('plein/mock@2')
    expect(nodeKey('volc/ark', 1)).toBe('volc/ark@1')
  })

  it('parseNodeKey 解析合法的版本化类型', () => {
    expect(parseNodeKey('plein/mock@1')).toEqual({ type: 'plein/mock', version: 1 })
    expect(parseNodeKey('plein/mock@12')).toEqual({ type: 'plein/mock', version: 12 })
    expect(parseNodeKey('a-b/c.d@3')).toEqual({ type: 'a-b/c.d', version: 3 })
  })

  it('parseNodeKey 拒绝无 @、非法版本号或非命名空间类型', () => {
    for (const key of [
      'plein/mock',
      'plein/mock@0',
      'plein/mock@-1',
      'plein/mock@1.5',
      'plein/mock@abc',
      'plein/mock@',
      'BADTYPE@1',
      'vendor/name/sub@2',
    ]) {
      expect(parseNodeKey(key)).toBeNull()
    }
  })
})

describe('modelRef / parseModelRef', () => {
  it('modelRef 拼出 provider:model', () => {
    expect(modelRef('plein/mock', 'echo-chat')).toBe('plein/mock:echo-chat')
  })

  it('parseModelRef 解析合法的模型引用', () => {
    expect(parseModelRef('plein/mock:echo-chat')).toEqual({
      provider: 'plein/mock',
      model: 'echo-chat',
    })
    expect(parseModelRef('volc/ark:doubao-seedance')).toEqual({
      provider: 'volc/ark',
      model: 'doubao-seedance',
    })
    expect(parseModelRef('plein/mock:a:b')).toEqual({ provider: 'plein/mock', model: 'a:b' })
  })

  it('parseModelRef 拒绝无冒号、空模型或非命名空间的 provider', () => {
    expect(parseModelRef('echo-chat')).toBeNull()
    expect(parseModelRef('plein/mock:')).toBeNull()
    expect(parseModelRef('BadProvider:model')).toBeNull()
    expect(parseModelRef(':model')).toBeNull()
  })
})
