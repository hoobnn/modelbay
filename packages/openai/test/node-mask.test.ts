import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type AdapterContext } from '@modelbay/core'
import sharp from 'sharp'
import { assertSameSize, prepareEditMask, prepareImageEditRequest } from '../src/node/index'

/** 生成一张纯色 PNG。 */
async function solid(width: number, height: number, value: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: value, g: value, b: value } },
    })
      .png()
      .toBuffer(),
  )
}

/** 生成一张左黑右白的蒙版。 */
async function halfMask(width: number, height: number): Promise<Uint8Array> {
  const right = Buffer.from(await solid(width, height, 255))
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: right, left: Math.floor(width / 2), top: 0 }])
      .png()
      .toBuffer(),
  )
}

describe('@modelbay/openai/node：蒙版辅助', () => {
  const source = { data: new Uint8Array([1]), mime: 'image/png', width: 1024, height: 1024 }
  it('原图与蒙版尺寸不同报错', () => {
    expect(() => assertSameSize(source, { ...source, height: 768 })).toThrow(ProviderError)
    expect(() => assertSameSize(source, source)).not.toThrow()
  })

  it('尺寸不一致时报 invalid_input', async () => {
    await expect(
      prepareEditMask(
        { data: await solid(4, 4, 10), mime: 'image/png' },
        { data: await solid(2, 2, 10), mime: 'image/png' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('无法解析的图片报 invalid_input', async () => {
    await expect(
      prepareEditMask(
        { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
        { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('蒙版 alpha 转换（sharp）', () => {
  it('白色重绘区变透明，黑色区变不透明', async () => {
    const prepared = await prepareEditMask(
      { data: await solid(2, 1, 128), mime: 'image/png' },
      {
        data: new Uint8Array(
          await sharp(Buffer.from([0, 255]), { raw: { width: 2, height: 1, channels: 1 } })
            .png()
            .toBuffer(),
        ),
        mime: 'image/png',
      },
    )
    const pixels = await sharp(prepared.mask.data).raw().toBuffer()
    expect([pixels[3], pixels[7]]).toEqual([255, 0])
    expect(prepared.width).toBe(2)
    expect(prepared.height).toBe(1)
  })

  it('原图摆正后统一转 PNG', async () => {
    const prepared = await prepareEditMask(
      { data: await solid(4, 4, 200), mime: 'image/png' },
      { data: await halfMask(4, 4), mime: 'image/png' },
    )
    expect(prepared.original.mime).toBe('image/png')
    expect(prepared.mask.mime).toBe('image/png')
    const meta = await sharp(prepared.original.data).metadata()
    expect(meta.width).toBe(4)
    expect(meta.height).toBe(4)
  })

  it('左黑右白的蒙版：左半不透明、右半透明', async () => {
    const prepared = await prepareEditMask(
      { data: await solid(4, 1, 10), mime: 'image/png' },
      { data: await halfMask(4, 1), mime: 'image/png' },
    )
    const pixels = await sharp(prepared.mask.data).raw().toBuffer()
    // 左两个像素是黑色（保留 → 不透明），右两个是白色（重绘 → 透明）
    expect([pixels[3], pixels[7]]).toEqual([255, 255])
    expect([pixels[11], pixels[15]]).toEqual([0, 0])
  })
})

describe('prepareImageEditRequest：Node 端准备编辑请求', () => {
  function ctxWith(assets: Record<string, Uint8Array>): AdapterContext {
    return {
      fetch: async () => new Response('{}'),
      signal: new AbortController().signal,
      secret: () => 'test-secret',
      log: () => {},
      assets: {
        load: async (assetId: string) => ({
          data: assets[assetId] ?? new Uint8Array([1]),
          mime: 'image/png',
        }),
      },
    }
  }

  it('蒙版转换后拼出 /images/edits 请求体', async () => {
    const ctx = ctxWith({
      source: await solid(2, 1, 128),
      mask: new Uint8Array(
        await sharp(Buffer.from([0, 255]), { raw: { width: 2, height: 1, channels: 1 } })
          .png()
          .toBuffer(),
      ),
    })
    const body = await prepareImageEditRequest(ctx, {
      prompt: '改天空',
      image: { assetId: 'source', kind: 'image' },
      mask: { assetId: 'mask', kind: 'image' },
    })
    expect(body.model).toBe('gpt-image-2.5-sunburst')
    expect(body.prompt).toBe('改天空')
    expect(body.n).toBe(1)
    expect(body.output_format).toBe('png')
    const images = body.images as Array<{ image_url: string }>
    expect(images[0]?.image_url).toMatch(/^data:image\/png;base64,/)
    const mask = body.mask as { image_url: string }
    expect(mask.image_url).toMatch(/^data:image\/png;base64,/)
  })

  it('没有 assets 或缺 prompt 时报 invalid_input', async () => {
    const bare: AdapterContext = {
      fetch: async () => new Response('{}'),
      signal: new AbortController().signal,
      secret: () => 'test-secret',
      log: () => {},
    }
    await expect(
      prepareImageEditRequest(bare, {
        prompt: 'x',
        image: { assetId: 'a', kind: 'image' },
        mask: { assetId: 'b', kind: 'image' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      prepareImageEditRequest(ctxWith({}), {
        prompt: ' ',
        image: { assetId: 'a', kind: 'image' },
        mask: { assetId: 'b', kind: 'image' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
