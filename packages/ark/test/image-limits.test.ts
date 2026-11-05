/**
 * Seedream 的上限（张数、参考图数量、分辨率档位）来自模型声明。
 *
 * 断言上限、提示与请求体。
 */
import { describe, expect, it } from 'vite-plus/test'
import type { ModelDeclaration } from '@modelbay/core'
import { createArkAdapter, models } from '../src/index'
import { fakeContext } from './helpers'

const PRO = 'ark:doubao-seedream-5-0-pro-260628'
const FLASH = 'ark:doubao-seedream-5-0-flash-260915'
const LITE = 'ark:doubao-seedream-5-0-260128'

const ref = { assetId: 'local-image', kind: 'image' as const }

/** 有素材库的假上下文：参考图要从这里读。 */
function ctxWithAssets() {
  const { ctx, fetch, body } = fakeContext([{ data: [{ b64_json: 'AQID' }] }], {
    secret: { ARK_API_KEY: 'test-secret' },
    assets: {
      load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }),
    },
  })
  return { ctx, fetch, body }
}

describe('参考图数量：超限时说明所选模型的实际上限', () => {
  it('pro 最多 10 张参考图', async () => {
    const { ctx, fetch } = ctxWithAssets()
    const error = await createArkAdapter(models)
      .submit(
        {
          capability: 'image.generate',
          model: PRO,
          input: {
            prompt: 'cat',
            references: Array.from({ length: 11 }, () => ref),
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'invalid_input',
      message: '所选模型最多接受 10 张参考图',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('分辨率档位：按声明里的档位换算尺寸', () => {
  it.each([
    [PRO, '16:9', '2720x1536'],
    [FLASH, '16:9', '2720x1536'],
    [LITE, '16:9', '2720x1536'],
    [PRO, '1:1', '2048x2048'],
    [PRO, '4:3', '2352x1760'],
    [PRO, '3:4', '1760x2352'],
  ])('%s 的画幅 %s 映射为官方 size %s', async (model, aspectRatio, size) => {
    const { ctx, body } = ctxWithAssets()
    await createArkAdapter(models).submit(
      {
        capability: 'image.generate',
        model,
        input: { prompt: 'cat', references: [], count: 1, extra: { aspectRatio } },
      },
      ctx,
    )
    expect(body().size).toBe(size)
    expect(body()).not.toHaveProperty('aspectRatio')
  })

  it.each([
    [PRO, '1K', '16:9', '1360x768'],
    [PRO, '2K', '9:16', '1536x2720'],
    [LITE, '4K', '1:1', '4096x4096'],
  ])('%s 的分辨率 %s 按画幅 %s 换算为 %s', async (model, resolution, aspectRatio, size) => {
    const { ctx, body } = ctxWithAssets()
    await createArkAdapter(models).submit(
      {
        capability: 'image.generate',
        model,
        input: { prompt: 'cat', resolution, extra: { aspectRatio } },
      },
      ctx,
    )
    expect(body().size).toBe(size)
  })

  it('模型不支持的分辨率直接报错', async () => {
    const { ctx, fetch } = ctxWithAssets()
    await expect(
      createArkAdapter(models).submit(
        {
          capability: 'image.generate',
          model: PRO,
          input: { prompt: 'cat', resolution: '4K', extra: { aspectRatio: '16:9' } },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('张数：组图只为声明允许多图的模型构造 sequential 参数', () => {
  it('lite 组图只发一次请求', async () => {
    const { ctx, body, fetch } = ctxWithAssets()
    await createArkAdapter(models).submit(
      { capability: 'image.generate', model: LITE, input: { prompt: 'cat', count: 3 } },
      ctx,
    )
    expect(body()).toMatchObject({
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 3 },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('pro 只支持单图', async () => {
    const { ctx } = ctxWithAssets()
    await expect(
      createArkAdapter(models).submit(
        { capability: 'image.generate', model: PRO, input: { prompt: 'cat', count: 2 } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('Lite 版的限制与 pro / flash 不同', () => {
  function limitsOf(model: string) {
    const canonicalId = model.replace('ark:', 'volc/')
    const found = models.find((item) => item.canonicalId === canonicalId)
    if (!found) throw new Error(`缺少声明 ${canonicalId}`)
    return found.limits ?? {}
  }

  it('声明里的上限逐项不同', () => {
    expect(limitsOf(LITE).count?.max).toBe(15)
    expect(limitsOf(LITE).references?.max).toBe(14)
    expect(limitsOf(LITE).resolutions).toEqual(['2K', '3K', '4K'])
    expect(limitsOf(PRO).count?.max).toBe(1)
    expect(limitsOf(PRO).references?.max).toBe(10)
    expect(limitsOf(PRO).resolutions).toEqual(['1K', '1.5K', '2K'])
    expect(limitsOf(FLASH).count?.max).toBe(1)
    expect(limitsOf(FLASH).references?.max).toBe(10)
    expect(limitsOf(FLASH).resolutions).toEqual(['1K', '1.5K', '2K'])
  })

  it('lite 能接 14 张参考图，pro 不能', async () => {
    const { ctx } = ctxWithAssets()
    await expect(
      createArkAdapter(models).submit(
        {
          capability: 'image.generate',
          model: LITE,
          input: { prompt: 'cat', references: Array.from({ length: 14 }, () => ref) },
        },
        ctx,
      ),
    ).resolves.toMatchObject({ state: 'succeeded' })
    const { ctx: proCtx } = ctxWithAssets()
    await expect(
      createArkAdapter(models).submit(
        {
          capability: 'image.generate',
          model: PRO,
          input: { prompt: 'cat', references: Array.from({ length: 14 }, () => ref) },
        },
        proCtx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('上限跟着声明走', () => {
  /** 造一条声明，把上限改小；适配器应当按新上限校验。 */
  function declaration(over: Partial<ModelDeclaration['limits']>): ModelDeclaration {
    return {
      canonicalId: 'volc/fake-seedream',
      id: 'fake-seedream',
      title: '假 Seedream',
      capabilities: ['image.generate'],
      limits: {
        resolutions: ['1K', '2K'],
        defaultResolution: '2K',
        count: { max: 2 },
        references: { max: 3 },
        ...over,
      },
      channels: [{ channel: 'ark', id: 'fake-seedream' }],
      aliases: {},
      lifecycle: {
        status: 'active',
        source: { url: 'https://example.test/docs', checkedAt: '2026-11-05' },
      },
      source: { url: 'https://example.test/docs', checkedAt: '2026-11-05' },
    }
  }

  it('声明里的 count.max 改小，校验跟着变', async () => {
    const adapter = createArkAdapter([declaration({ count: { max: 2 } })])
    const { ctx } = ctxWithAssets()
    await expect(
      adapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:fake-seedream',
          input: { prompt: 'cat', count: 3 },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const { ctx: okCtx } = ctxWithAssets()
    await expect(
      adapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:fake-seedream',
          input: { prompt: 'cat', count: 2 },
        },
        okCtx,
      ),
    ).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('声明里的 references.max 改小，校验跟着变', async () => {
    const adapter = createArkAdapter([declaration({ references: { max: 1 } })])
    const { ctx } = ctxWithAssets()
    await expect(
      adapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:fake-seedream',
          input: { prompt: 'cat', references: [ref, ref] },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('声明里的 resolutions 改小，校验跟着变', async () => {
    const adapter = createArkAdapter([declaration({ resolutions: ['1K'] })])
    const { ctx } = ctxWithAssets()
    await expect(
      adapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:fake-seedream',
          input: { prompt: 'cat', resolution: '2K' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('声明里没写上限就不校验这一项，透传给上游', async () => {
    const adapter = createArkAdapter([
      declaration({ count: undefined, references: undefined, resolutions: undefined }),
    ])
    const { ctx, body } = ctxWithAssets()
    await expect(
      adapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:fake-seedream',
          input: { prompt: 'cat', count: 7, references: [ref, ref, ref, ref, ref] },
        },
        ctx,
      ),
    ).resolves.toMatchObject({ state: 'succeeded' })
    expect(body().sequential_image_generation_options).toEqual({ max_images: 7 })
  })
})
