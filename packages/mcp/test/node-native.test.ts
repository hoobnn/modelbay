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
    expect(PLATFORMS['doubao-speech'].nodeNatives).toMatchObject([
      {
        subpath: 'interpretation',
        export: 'interpretAudio',
        option: 'interpretation',
      },
      {
        subpath: 'asr',
        export: 'runAsrStream',
        option: 'asr',
      },
    ])
  })

  it('流式识别实现也从 Node 子路径注入', async () => {
    const adapter = await loadAdapter('doubao-speech')
    // 注入了真实实现：缺凭证时按真实实现报错，而不是返回「请求计划」
    const ctx = {
      secret: () => undefined,
      log: () => undefined,
    } as unknown as AdapterContext
    await expect(
      adapter?.native?.('raw-request', { product: 'asr_stream', audio: 'x.wav' }, ctx),
    ).rejects.toMatchObject({ code: 'auth' })
  })

  it('asr_websocket 走同一份流式识别实现', async () => {
    const adapter = await loadAdapter('doubao-speech')
    const ctx = {
      secret: () => undefined,
      log: () => undefined,
    } as unknown as AdapterContext
    await expect(
      adapter?.native?.('raw-request', { product: 'asr_websocket', audio: 'x.wav' }, ctx),
    ).rejects.toMatchObject({ code: 'auth' })
  })
})

describe('Node 子路径的适配器注入点', () => {
  it('方舟的参考视频上传实现被注入', async () => {
    const adapter = await loadAdapter('ark')
    expect(adapter?.id).toBe('volc/ark')
    // 注入了真实上传实现：缺存储配置时按真实实现报错，而不是「没有注入」
    const ctx = {
      secret: (name: string) => (name === 'ARK_API_KEY' ? 'key' : undefined),
      log: () => undefined,
      assets: {
        load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'video/mp4' }),
      },
    } as unknown as AdapterContext
    const error = await adapter
      ?.submit(
        {
          capability: 'video.generate',
          model: 'ark:doubao-seedance-2-0-260128',
          input: {
            prompt: '运镜',
            references: [{ assetId: 'a', kind: 'video' }],
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({ code: 'invalid_input' })
    expect((error as Error).message).toContain('ARK_REFERENCE_STORAGE')
  })

  it('百炼的局部重绘与精修实现被注入', async () => {
    const adapter = await loadAdapter('bailian')
    expect(adapter?.id).toBe('aliyun/bailian')
    const ctx = {
      secret: () => undefined,
      log: () => undefined,
    } as unknown as AdapterContext
    const edit = await adapter
      ?.submit(
        {
          capability: 'image.edit',
          model: 'wanx2.1-imageedit',
          input: {
            prompt: '把杯子换成红色',
            image: { assetId: 'a', kind: 'image' },
            mask: { assetId: 'b', kind: 'image' },
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    // 注入了真实实现：走到「缺素材库」而不是「没有注入」
    expect(edit).toMatchObject({ code: 'invalid_input' })
    expect((edit as Error).message).not.toContain('@modelbay/bailian/node')

    const process = await adapter
      ?.submit(
        {
          capability: 'image.process',
          model: 'wanx2.1-imageedit',
          input: { image: { assetId: 'a', kind: 'image' }, operation: 'upscale', scale: 2 },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(process).toMatchObject({ code: 'invalid_input' })
    expect((process as Error).message).not.toContain('@modelbay/bailian/node')
  })

  it('平台元数据声明了各家 Node 子路径', () => {
    expect(PLATFORMS.ark.nodeNatives).toMatchObject([
      { subpath: 'tos', export: 'uploadReferenceVideo', option: 'uploadVideo' },
    ])
    expect(PLATFORMS.bailian.nodeNatives).toMatchObject([
      { subpath: 'image-edit', export: 'prepareImageEditRequest', option: 'edit' },
      { subpath: 'image-edit', export: 'prepareImageProcessRequest', option: 'process' },
    ])
  })
})
