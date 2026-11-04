import { describe, expect, it } from 'vite-plus/test'
import { createCliDeps } from '../src/deps'
import type { CliSdk } from '../src/deps'
import type { CliDeclaration } from '../src/commands'

const declarations: CliDeclaration[] = [
  {
    canonicalId: 'ark/seedream',
    capabilities: ['image.generate'],
    channels: [{ channel: 'ark' }],
    lifecycle: { status: 'active' },
  },
]

function fakeSdk(overrides: Partial<CliSdk> = {}): CliSdk {
  return {
    registry: { all: () => declarations },
    capabilities: () => ['image.generate'],
    doctor: () => ({
      entries: [{ platform: 'ark', names: ['ARK_API_KEY'], configured: true }],
      ok: true,
    }),
    generate: async () => ({ outputs: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  }
}

describe('createCliDeps', () => {
  it('models 直接来自注册表', () => {
    const deps = createCliDeps(fakeSdk())
    expect(deps.models()).toEqual(declarations)
  })

  it('capabilities 与 doctor 原样透传', () => {
    const deps = createCliDeps(fakeSdk())
    expect(deps.capabilities()).toEqual(['image.generate'])
    expect(deps.doctor().ok).toBe(true)
    expect(deps.doctor().entries[0]?.platform).toBe('ark')
  })

  it('generate 把 capability、model、input 和 signal 传给 SDK', async () => {
    let captured: unknown
    const deps = createCliDeps(
      fakeSdk({
        generate: async (request) => {
          captured = request
          return { outputs: [{ type: 'text', text: 'ok' }] }
        },
      }),
    )
    const signal = new AbortController().signal
    const outcome = await deps.generate({
      capability: 'image.generate',
      model: 'ark:seedream',
      input: { prompt: 'a cat' },
      signal,
    })
    expect(outcome.outputs).toEqual([{ type: 'text', text: 'ok' }])
    expect(captured).toEqual({
      capability: 'image.generate',
      model: 'ark:seedream',
      input: { prompt: 'a cat' },
      signal,
    })
  })

  it('没给 model 和 signal 时不会塞空字段', async () => {
    let captured: Record<string, unknown> = {}
    const deps = createCliDeps(
      fakeSdk({
        generate: async (request) => {
          captured = request as unknown as Record<string, unknown>
          return { outputs: [] }
        },
      }),
    )
    await deps.generate({ capability: 'image.generate', input: { prompt: 'x' } })
    expect(captured).toEqual({ capability: 'image.generate', input: { prompt: 'x' } })
    expect('model' in captured).toBe(false)
    expect('signal' in captured).toBe(false)
  })
})
