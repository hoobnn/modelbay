import { describe, expect, it, vi } from 'vite-plus/test'
import { defineAdapter, createAdapterContext, adapterCapabilities } from './adapter'
import type { PlatformAdapter } from './adapter'
import type { ModelDeclaration } from './declarations'

const source = { url: 'https://platform.example.com/docs', checkedAt: '2026-11-04' }

const declaration = (
  canonicalId: string,
  capabilities: ModelDeclaration['capabilities'] = ['audio.speech'],
): ModelDeclaration => ({
  canonicalId,
  id: canonicalId.split('/')[1] ?? canonicalId,
  title: canonicalId,
  capabilities,
  channels: [{ channel: 'minimax', id: canonicalId }],
  aliases: {},
  lifecycle: { status: 'active', source },
  source,
})

const makeAdapter = (overrides: Partial<PlatformAdapter> = {}): PlatformAdapter =>
  ({
    id: 'volc/ark',
    title: 'Volcengine Ark',
    channels: ['ark', 'ark-plan'],
    models: [declaration('volc/seedance'), declaration('volc/seedream', ['image.generate'])],
    submit: async () => ({ state: 'succeeded' as const, outputs: [] }),
    ...overrides,
  }) as PlatformAdapter

describe('defineAdapter', () => {
  it('合法定义原样返回', () => {
    const a = makeAdapter()
    expect(defineAdapter(a)).toBe(a)
  })

  it('id 不是 vendor/name 时抛错', () => {
    expect(() => defineAdapter(makeAdapter({ id: 'BadId' }))).toThrow(/应为 vendor\/name/)
    expect(() => defineAdapter(makeAdapter({ id: 'Volc/ark' }))).toThrow(/应为 vendor\/name/)
  })

  it('没有渠道时抛错', () => {
    expect(() => defineAdapter(makeAdapter({ channels: [] }))).toThrow(/至少要有一个渠道/)
  })

  it('模型 canonicalId 重复时抛错', () => {
    expect(() =>
      defineAdapter(makeAdapter({ models: [declaration('volc/x'), declaration('volc/x')] })),
    ).toThrow(/重复/)
  })
})

describe('createAdapterContext', () => {
  it('缺省时用全局 fetch、新建信号、空 secret 与空 log', () => {
    const ctx = createAdapterContext()
    expect(ctx.fetch).toBe(fetch)
    expect(ctx.signal.aborted).toBe(false)
    expect(ctx.secret('anything')).toBeUndefined()
    expect(ctx.hooks).toBeUndefined()
    expect(ctx.assets).toBeUndefined()
    expect(ctx.jobs).toBeUndefined()
    expect(() => ctx.log('hi')).not.toThrow()
  })

  it('注入 fetch、secrets、signal、hooks、assets、jobs、log', () => {
    const fetchImpl = vi.fn(async () => new Response(''))
    const secrets = { key: 'value' }
    const signal = new AbortController().signal
    const hooks = { onUsage: vi.fn() }
    const assets = { load: vi.fn() }
    const jobs = { save: vi.fn(), get: vi.fn(), list: vi.fn() }
    const log = vi.fn()
    const ctx = createAdapterContext({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      secrets,
      signal,
      hooks,
      assets,
      jobs,
      log,
    })
    expect(ctx.fetch).toBe(fetchImpl)
    expect(ctx.secret('key')).toBe('value')
    expect(ctx.secret('missing')).toBeUndefined()
    expect(ctx.signal).toBe(signal)
    expect(ctx.hooks).toBe(hooks)
    expect(ctx.assets).toBe(assets)
    expect(ctx.jobs).toBe(jobs)
    expect(ctx.log).toBe(log)
    ctx.log('hello', { a: 1 })
    expect(log).toHaveBeenCalledWith('hello', { a: 1 })
  })

  it('注入 plein 宿主语义：settings / stream / files / 幂等键 / 回执 / socket', () => {
    const stream = vi.fn()
    const files = { read: vi.fn(async () => ({ data: new Uint8Array([1]), mime: 'image/png' })) }
    const submission = { requestId: 'req-1', response: vi.fn() }
    const socket = vi.fn()
    const ctx = createAdapterContext({
      settings: { region: 'cn' },
      stream,
      files,
      idempotencyKey: 'idem-1',
      submission,
      socket,
    })
    expect(ctx.settings).toEqual({ region: 'cn' })
    expect(ctx.stream).toBe(stream)
    expect(ctx.files).toBe(files)
    expect(ctx.idempotencyKey).toBe('idem-1')
    expect(ctx.submission).toBe(submission)
    expect(ctx.socket).toBe(socket)
  })

  it('未注入的 plein 可选字段保持缺省', () => {
    const ctx = createAdapterContext()
    expect(ctx.settings).toBeUndefined()
    expect(ctx.stream).toBeUndefined()
    expect(ctx.files).toBeUndefined()
    expect(ctx.idempotencyKey).toBeUndefined()
    expect(ctx.submission).toBeUndefined()
    expect(ctx.socket).toBeUndefined()
  })

  it('AdapterRequest 接受 usage / remoteOnly 标记', async () => {
    const seen: unknown[] = []
    const adapter = makeAdapter({
      submit: async (req) => {
        seen.push({ usage: req.usage, remoteOnly: req.remoteOnly })
        return { state: 'succeeded' as const, outputs: [] }
      },
    })
    await adapter.submit(
      {
        capability: 'text.chat',
        model: 'volc/x',
        input: { messages: [{ role: 'user', content: 'hi' }] },
        usage: 'agent',
        remoteOnly: true,
      },
      createAdapterContext(),
    )
    expect(seen[0]).toEqual({ usage: 'agent', remoteOnly: true })
  })
})

describe('adapterCapabilities', () => {
  it('汇总所有模型能力并去重', () => {
    const adapter = makeAdapter({
      models: [
        declaration('volc/a', ['audio.speech', 'text.chat']),
        declaration('volc/b', ['image.generate', 'text.chat']),
      ],
    })
    expect(adapterCapabilities(adapter)).toEqual(['audio.speech', 'text.chat', 'image.generate'])
  })

  it('没有模型时返回空数组', () => {
    expect(adapterCapabilities(makeAdapter({ models: [] }))).toEqual([])
  })
})
