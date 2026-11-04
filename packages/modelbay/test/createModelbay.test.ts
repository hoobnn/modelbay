import { describe, expect, it } from 'vite-plus/test'
import {
  ModelRegistry,
  createModelbay,
  defineAdapter,
  type Capability,
  type LifecycleStatus,
  type ModelDeclaration,
  type NormalizedCapability,
  type PlatformAdapter,
  type ProviderOutput,
} from '../src/index'

const SOURCE = { url: 'https://example.com/doc', checkedAt: '2026-11-04' }

function declaration(
  canonicalId: string,
  capability: NormalizedCapability,
  status: LifecycleStatus,
  channel = 'test',
): ModelDeclaration {
  const id = canonicalId.split('/')[1] ?? canonicalId
  return {
    canonicalId,
    id,
    title: canonicalId,
    capabilities: [capability],
    channels: [{ channel, id }],
    aliases: {},
    lifecycle: { status, source: { ...SOURCE } },
    source: { ...SOURCE },
  }
}

function file(url: string): ProviderOutput {
  return { type: 'file', kind: 'image', mime: 'image/png', url }
}

/** 注入的假 fetch：不联网，只返回一个成功的响应 */
function fakeFetch(): typeof fetch {
  return async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
}

interface Recorder {
  model?: string
  capability?: string
  polls: number
  fetches: number
}

function makeImageAdapter(rec: Recorder): PlatformAdapter {
  return defineAdapter({
    id: 'test/image',
    title: 'Test Image',
    channels: ['test'],
    models: [
      declaration('test/active-image', 'image.generate', 'active'),
      declaration('test/sunsetting-image', 'image.generate', 'sunsetting'),
    ],
    async submit(request, ctx) {
      rec.model = request.model
      rec.capability = request.capability as Capability
      const response = await ctx.fetch('https://example.test/generate')
      rec.fetches += 1
      if (!response.ok) throw new Error('fake fetch failed')
      return { state: 'succeeded', outputs: [file('https://cdn.example/image.png')] }
    },
  })
}

function makeAsyncAdapter(rec: Recorder): PlatformAdapter {
  return defineAdapter({
    id: 'test/async',
    title: 'Test Async Video',
    channels: ['async'],
    models: [declaration('test/active-video', 'video.generate', 'active', 'async')],
    async submit() {
      return { state: 'pending', remoteId: 'remote-1', pollAfterMs: 0 }
    },
    async poll() {
      rec.polls += 1
      if (rec.polls < 2) return { state: 'pending', pollAfterMs: 0, remote: 'running' }
      return { state: 'succeeded', outputs: [file('https://cdn.example/video.mp4')] }
    },
  })
}

describe('createModelbay 汇总入口', () => {
  it('再导出 core 公共 API 与注册表', () => {
    expect(typeof defineAdapter).toBe('function')
    expect(typeof ModelRegistry).toBe('function')
    const mb = createModelbay({
      adapters: [makeImageAdapter({ polls: 0, fetches: 0 })],
      secrets: {},
    })
    expect(mb.registry).toBeInstanceOf(ModelRegistry)
    expect(mb.registry.all()).toHaveLength(2)
    expect(mb.adapters).toHaveLength(1)
  })

  it('十行调用路径：不传 model 时由 defaultFor 选 active 默认模型，结果只返回 URL', async () => {
    const rec: Recorder = { polls: 0, fetches: 0 }
    const mb = createModelbay({
      adapters: [makeImageAdapter(rec)],
      secrets: {},
      fetch: fakeFetch(),
    })
    const { outputs } = await mb.generate({
      capability: 'image.generate',
      input: { prompt: 'a cat' },
    })
    expect(rec.model).toBe('active-image')
    expect(rec.capability).toBe('image.generate')
    expect(rec.fetches).toBe(1) // 用了注入的 ctx.fetch，没有联网
    expect(outputs).toEqual([file('https://cdn.example/image.png')])
  })

  it('非 active 声明不能当默认', () => {
    const mb = createModelbay({
      adapters: [makeImageAdapter({ polls: 0, fetches: 0 })],
      secrets: {},
    })
    const selected = mb.registry.defaultFor('image.generate')
    expect(selected?.declaration.lifecycle.status).toBe('active')
    expect(selected?.channel.id).toBe('active-image')
  })

  it('显式 model 由 resolve 路由到对应渠道', async () => {
    const rec: Recorder = { polls: 0, fetches: 0 }
    const mb = createModelbay({
      adapters: [makeImageAdapter(rec)],
      secrets: {},
      fetch: fakeFetch(),
    })
    await mb.generate({
      capability: 'image.generate',
      model: 'test:sunsetting-image',
      input: { prompt: 'x' },
    })
    expect(rec.model).toBe('sunsetting-image')
  })

  it('异步任务的轮询由 core 的 runJob 处理', async () => {
    const rec: Recorder = { polls: 0, fetches: 0 }
    const mb = createModelbay({
      adapters: [makeAsyncAdapter(rec)],
      secrets: {},
      fetch: fakeFetch(),
      maxWaitMs: 5000,
    })
    const outcome = await mb.generate({
      capability: 'video.generate',
      input: { prompt: 'a wave' },
    })
    expect(rec.polls).toBe(2)
    expect(outcome.remoteId).toBe('remote-1')
    expect(outcome.outputs).toEqual([file('https://cdn.example/video.mp4')])
  })

  it('capabilities 聚合去重', () => {
    const mb = createModelbay({
      adapters: [
        makeImageAdapter({ polls: 0, fetches: 0 }),
        makeAsyncAdapter({ polls: 0, fetches: 0 }),
      ],
      secrets: {},
    })
    expect(mb.capabilities()).toEqual(['image.generate', 'video.generate'])
  })

  it('doctor 只报告配置状态，绝不含密钥值', () => {
    const mb = createModelbay({
      adapters: [makeImageAdapter({ polls: 0, fetches: 0 })],
      secrets: { ARK_API_KEY: 'sk-SUPER-SECRET' },
    })
    const report = mb.doctor()
    expect(JSON.stringify(report)).not.toContain('sk-SUPER-SECRET')
    expect(report.entries.find((entry) => entry.platform === 'ark')?.configured).toBe(true)
    expect(report.ok).toBe(true)
  })

  it('自定义 ID 缺少渠道前缀时明确报错', async () => {
    const mb = createModelbay({
      adapters: [makeImageAdapter({ polls: 0, fetches: 0 })],
      secrets: {},
      fetch: fakeFetch(),
    })
    await expect(
      mb.generate({
        capability: 'image.generate',
        model: 'some-custom-id',
        input: { prompt: 'x' },
      }),
    ).rejects.toThrow(/渠道:模型ID/)
  })

  it('没有 active 默认模型时明确报错', async () => {
    const onlySunsetting = defineAdapter({
      id: 'test/none',
      title: 'No Active',
      channels: ['none'],
      models: [declaration('test/only-sunsetting', 'image.generate', 'sunsetting', 'none')],
      async submit() {
        return { state: 'succeeded', outputs: [] }
      },
    })
    const mb = createModelbay({ adapters: [onlySunsetting], secrets: {} })
    await expect(
      mb.generate({ capability: 'image.generate', input: { prompt: 'x' } }),
    ).rejects.toThrow(/active 默认模型/)
  })
})
