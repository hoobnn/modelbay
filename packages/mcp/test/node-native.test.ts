/**
 * Node 子路径的 native 实现注入。
 *
 * 有些 native 操作（豆包语音的同传）要连 WebSocket、用 Node 专属依赖，
 * 实现放在 Node 子路径里，由 launch.ts 加载后注入适配器。
 */
import { describe, expect, it } from 'vite-plus/test'
import type { AdapterContext } from '@modelbay/core'
import { loadAdapter } from '../src/launch'
import { PLATFORMS } from '../src/platform'

describe('Node 子路径的 native 实现注入', () => {
  it('豆包语音的适配器能加载，同传实现从 Node 子路径注入', async () => {
    const adapter = await loadAdapter('doubao-speech')
    expect(adapter).toBeDefined()
    expect(adapter?.nativeOperations).toContain('simultaneous-interpretation')
    // 注入了真实实现：缺凭证时按真实实现报错，而不是返回「请求计划」
    const ctx = {
      secret: () => undefined,
      log: () => undefined,
    } as unknown as AdapterContext
    await expect(
      adapter?.native?.(
        'simultaneous-interpretation',
        { audio: 'x', source_language: 'zh', target_language: 'en' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'auth' })
  })

  it('平台元数据声明了 Node 子路径', () => {
    expect(PLATFORMS['doubao-speech'].nodeNative).toMatchObject({
      subpath: 'interpretation',
      export: 'interpretAudio',
      option: 'interpretation',
    })
  })
})
