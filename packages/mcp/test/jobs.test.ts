import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterContext } from '@modelbay/core'
import type { PlatformAdapter, ProviderOutput } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { deliver, pollUntil } from '../src/jobs'

describe('deliver', () => {
  it('适配器给同名文件时也不互相覆盖，多次调用同样如此', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modelbay-deliver-'))
    const context = createAdapterContext({ secrets: {} })
    const image = (byte: number): ProviderOutput => ({
      type: 'file',
      kind: 'image',
      name: 'bailian.png',
      mime: 'image/png',
      data: Uint8Array.from([byte]),
    })
    const first = (await deliver([image(1), image(2)], dir, 'generate_image', context)) as Array<{
      path: string
    }>
    const second = (await deliver([image(3)], dir, 'generate_image', context)) as Array<{
      path: string
    }>
    const paths = [...first, ...second].map((item) => item.path)
    expect(new Set(paths).size).toBe(3)
    expect(readdirSync(dir)).toHaveLength(3)
    for (const path of paths) expect(path).toMatch(/[/\\]bailian-.+\.png$/)
  })
})

describe('pollUntil', () => {
  it('轮询间隔正常结束后摘掉 abort 监听，长期共用的 signal 不会越积越多', async () => {
    const controller = new AbortController()
    let added = 0
    let removed = 0
    const signal = controller.signal
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((...args: Parameters<typeof add>) => {
      added += 1
      add(...args)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
      removed += 1
      remove(...args)
    }) as typeof signal.removeEventListener
    let calls = 0
    const adapter = {
      poll: async () =>
        ++calls < 3
          ? { state: 'pending' as const, pollAfterMs: 1 }
          : { state: 'succeeded' as const, outputs: [] },
    } as unknown as PlatformAdapter
    const context = createAdapterContext({ secrets: {}, signal })
    expect((await pollUntil(adapter, 'job', context, 5)).state).toBe('succeeded')
    expect(added).toBe(2)
    expect(removed).toBe(added)
  })
})
