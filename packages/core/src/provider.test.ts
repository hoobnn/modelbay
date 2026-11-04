import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import {
  Capability,
  ProviderErrorCode,
  ProviderError,
  defineProvider,
  providerConfigured,
} from './provider'
import type { ModelSpec, ProviderDefinition, SecretSpec, SubmitResult } from './provider'

const model: ModelSpec = { id: 'm1', title: 'M1', capabilities: ['text.chat'] }
const settings = z.object({ base: z.string().default('https://api.example') })
const submit = async (): Promise<SubmitResult> => ({ state: 'succeeded', outputs: [] })

const baseDef = (): ProviderDefinition => ({
  id: 'plein/mock',
  title: 'Mock',
  settings,
  secrets: [{ name: 'apiKey', title: 'Key' }],
  models: [model],
  submit,
})

const def = (patch: Partial<ProviderDefinition> = {}): ProviderDefinition =>
  defineProvider({ ...baseDef(), ...patch } as ProviderDefinition)

const confDef = (
  secrets: SecretSpec[],
  credentialAlternatives?: string[][],
): ProviderDefinition => ({
  id: 'plein/mock',
  title: 'Mock',
  settings,
  secrets,
  ...(credentialAlternatives ? { credentialAlternatives } : {}),
  models: [model],
  submit,
})

describe('defineProvider', () => {
  it('合法定义原样返回', () => {
    const d = baseDef()
    expect(defineProvider(d)).toBe(d)
  })

  it('id 不是 vendor/name 时抛错', () => {
    expect(() => def({ id: 'BadId' })).toThrow(/应为 vendor\/name/)
    expect(() => def({ id: 'Vendor/name' })).toThrow(/应为 vendor\/name/)
  })

  it('鉴权组引用未声明密钥或为空时抛错', () => {
    expect(() => def({ credentialAlternatives: [['unknown']] })).toThrow(
      /鉴权组必须引用已声明的密钥/,
    )
    expect(() => def({ credentialAlternatives: [[]] })).toThrow(/鉴权组必须引用已声明的密钥/)
    expect(() =>
      def({
        secrets: [
          { name: 'a', title: 'A' },
          { name: 'b', title: 'B' },
        ],
        credentialAlternatives: [['a'], ['b'], ['a', 'missing']],
      }),
    ).toThrow(/鉴权组必须引用已声明的密钥/)
  })

  it('鉴权组全部引用已声明密钥时通过', () => {
    const d = {
      ...baseDef(),
      secrets: [
        { name: 'a', title: 'A' },
        { name: 'b', title: 'B' },
      ],
      credentialAlternatives: [['a'], ['b']],
    }
    expect(defineProvider(d)).toBe(d)
  })

  it('模型 id 重复或没有声明能力时抛错', () => {
    expect(() => def({ models: [model, model] })).toThrow(/重复/)
    expect(() => def({ models: [{ id: 'empty', title: 'E', capabilities: [] }] })).toThrow(
      /没有声明能力/,
    )
  })

  it('设置项没有默认值时抛错', () => {
    expect(() => def({ settings: z.object({ key: z.string() }) })).toThrow(/设置项需要都有默认值/)
  })
})

describe('providerConfigured', () => {
  it('没有必填密钥、没有鉴权组时总是已配置', () => {
    expect(providerConfigured(confDef([]), {})).toBe(true)
    expect(providerConfigured(confDef([{ name: 'opt', title: 'Opt' }]), {})).toBe(true)
  })

  it('必填密钥必须非空且非纯空白', () => {
    const d = confDef([{ name: 'k', title: 'K', required: true }])
    expect(providerConfigured(d, { k: 'abc' })).toBe(true)
    expect(providerConfigured(d, {})).toBe(false)
    expect(providerConfigured(d, { k: '' })).toBe(false)
    expect(providerConfigured(d, { k: '   ' })).toBe(false)
  })

  it('鉴权组要求整组密钥都填了才算配置', () => {
    const d = confDef([], [['a', 'b']])
    expect(providerConfigured(d, { a: '1', b: '2' })).toBe(true)
    expect(providerConfigured(d, { a: '1' })).toBe(false)
    expect(providerConfigured(d, { a: '1', b: '  ' })).toBe(false)
  })

  it('多个鉴权组任意一组满足即可', () => {
    const d = confDef([], [['a', 'b'], ['c']])
    expect(providerConfigured(d, { c: '1' })).toBe(true)
    expect(providerConfigured(d, { a: '1' })).toBe(false)
  })

  it('空鉴权组不算满足', () => {
    expect(providerConfigured(confDef([], [[]]), {})).toBe(false)
  })

  it('必填密钥和鉴权组要同时满足', () => {
    const d = confDef([{ name: 'k', title: 'K', required: true }], [['a']])
    expect(providerConfigured(d, { k: 'x', a: '1' })).toBe(true)
    expect(providerConfigured(d, { k: 'x' })).toBe(false)
    expect(providerConfigured(d, { a: '1' })).toBe(false)
  })
})

describe('ProviderError', () => {
  it('默认 retryable：限流 / 不可用 / 超时为可重试，其余不可', () => {
    expect(new ProviderError('rate_limit', 'x').retryable).toBe(true)
    expect(new ProviderError('unavailable', 'x').retryable).toBe(true)
    expect(new ProviderError('timeout', 'x').retryable).toBe(true)
    expect(new ProviderError('auth', 'x').retryable).toBe(false)
    expect(new ProviderError('invalid_input', 'x').retryable).toBe(false)
    expect(new ProviderError('unknown', 'x').retryable).toBe(false)
  })

  it('显式 retryable 覆盖默认值', () => {
    expect(new ProviderError('auth', 'x', { retryable: true }).retryable).toBe(true)
    expect(new ProviderError('rate_limit', 'x', { retryable: false }).retryable).toBe(false)
  })

  it('保留 code、message、name、cause 与 outcome', () => {
    const cause = new Error('orig')
    const err = new ProviderError('unknown', '出错了', { cause, outcome: 'unknown' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ProviderError')
    expect(err.code).toBe('unknown')
    expect(err.message).toBe('出错了')
    expect(err.cause).toBe(cause)
    expect(err.outcome).toBe('unknown')
  })

  it('缺省 outcome 与 cause 时不设置', () => {
    const err = new ProviderError('auth', 'x')
    expect(err.outcome).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })
})

describe('Capability 与 ProviderErrorCode 枚举', () => {
  it('Capability 有 9 种', () => {
    expect(Capability.options).toHaveLength(9)
    expect(Capability.safeParse('text.chat').success).toBe(true)
    expect(Capability.safeParse('bogus').success).toBe(false)
  })

  it('ProviderErrorCode 有 9 种', () => {
    expect(ProviderErrorCode.options).toHaveLength(9)
    expect(ProviderErrorCode.options).toContain('rate_limit')
    expect(ProviderErrorCode.safeParse('cancelled').success).toBe(true)
    expect(ProviderErrorCode.safeParse('bogus').success).toBe(false)
  })
})
