import { describe, expect, it } from 'vite-plus/test'
import { PortType, PortSpec, AssetKind, CompositionSourceRef, portAccepts } from './ports'

const hex64 = 'a'.repeat(64)

describe('端口与资产 schema', () => {
  it('PortType 只接受六种值', () => {
    for (const type of ['text', 'image', 'video', 'audio', 'json', 'any']) {
      expect(PortType.safeParse(type).success).toBe(true)
    }
    expect(PortType.safeParse('blob').success).toBe(false)
  })

  it('PortSpec 校验 id、type 与可选布尔', () => {
    expect(
      PortSpec.safeParse({
        id: 'input',
        label: '输入',
        type: 'image',
        multiple: true,
        required: false,
      }).success,
    ).toBe(true)
    expect(PortSpec.safeParse({ id: 'out1', label: '输出', type: 'any' }).success).toBe(true)
    expect(PortSpec.safeParse({ id: '1bad', label: 'x', type: 'text' }).success).toBe(false)
    expect(PortSpec.safeParse({ id: 'a-b', label: 'x', type: 'text' }).success).toBe(false)
    expect(PortSpec.safeParse({ id: 'ok', label: 'x', type: 'blob' }).success).toBe(false)
    expect(
      PortSpec.safeParse({ id: 'ok', label: 'x', type: 'text', multiple: 'yes' }).success,
    ).toBe(false)
  })

  it('AssetKind 只接受四类资产', () => {
    for (const kind of ['image', 'video', 'audio', 'file']) {
      expect(AssetKind.safeParse(kind).success).toBe(true)
    }
    expect(AssetKind.safeParse('text').success).toBe(false)
  })

  it('CompositionSourceRef 校验版本、64 位十六进制资产 id 与上限', () => {
    const valid = {
      version: 1,
      bundleAssetId: hex64,
      manifestAssetId: hex64,
      dependencyAssetIds: [hex64],
      rendererIdentity: 'renderer-v1',
    }
    expect(CompositionSourceRef.safeParse(valid).success).toBe(true)
    expect(CompositionSourceRef.safeParse({ ...valid, version: 2 }).success).toBe(false)
    expect(CompositionSourceRef.safeParse({ ...valid, bundleAssetId: 'abc' }).success).toBe(false)
    expect(
      CompositionSourceRef.safeParse({ ...valid, manifestAssetId: hex64.toUpperCase() }).success,
    ).toBe(false)
    expect(
      CompositionSourceRef.safeParse({ ...valid, dependencyAssetIds: Array(101).fill(hex64) })
        .success,
    ).toBe(false)
    expect(CompositionSourceRef.safeParse({ ...valid, rendererIdentity: '' }).success).toBe(false)
    expect(
      CompositionSourceRef.safeParse({ ...valid, rendererIdentity: 'x'.repeat(501) }).success,
    ).toBe(false)
  })
})

describe('portAccepts', () => {
  it('any 端口接受所有值类型', () => {
    for (const type of ['text', 'json', 'image', 'video', 'audio'] as const) {
      expect(portAccepts('any', type)).toBe(true)
    }
  })

  it('具体端口只接受同类型', () => {
    expect(portAccepts('text', 'text')).toBe(true)
    expect(portAccepts('image', 'image')).toBe(true)
    expect(portAccepts('video', 'audio')).toBe(false)
    expect(portAccepts('json', 'text')).toBe(false)
  })
})
