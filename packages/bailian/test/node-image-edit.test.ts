import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type AdapterContext } from '@modelbay/core'
import { vi } from 'vite-plus/test'
import sharp from 'sharp'
import {
  buildImageEditRequest,
  IMAGE_EDIT_PATH,
  MASK_MAX_SIDE,
  MASK_MIN_SIDE,
  prepareEditMask,
  prepareImageEditRequest,
} from '../src/node/image-edit'

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

/** 生成一张左黑右灰的蒙版。 */
async function halfMask(width: number, height: number): Promise<Uint8Array> {
  const right = Buffer.from(await solid(width, height, 128))
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: right, left: Math.floor(width / 2), top: 0 }])
      .png()
      .toBuffer(),
  )
}

describe('Node-only image-edit subpath', () => {
  it('builds a description_edit_with_mask request', () => {
    expect(IMAGE_EDIT_PATH).toBe('/api/v1/services/aigc/image2image/image-synthesis')
    expect(
      buildImageEditRequest({
        prompt: '换背景',
        baseImageUrl: 'oss://a/base.png',
        maskImageUrl: 'oss://a/mask.png',
        seed: 7,
      }),
    ).toEqual({
      model: 'wanx2.1-imageedit',
      input: {
        function: 'description_edit_with_mask',
        prompt: '换背景',
        base_image_url: 'oss://a/base.png',
        mask_image_url: 'oss://a/mask.png',
      },
      parameters: { n: 1, seed: 7 },
    })
  })
  it('validates prompt and urls', () => {
    expect(() =>
      buildImageEditRequest({ prompt: '', baseImageUrl: 'a', maskImageUrl: 'b' }),
    ).toThrow(ProviderError)
    expect(() =>
      buildImageEditRequest({ prompt: 'x', baseImageUrl: '', maskImageUrl: 'b' }),
    ).toThrow(ProviderError)
  })
})

describe('蒙版处理（sharp）', () => {
  it('输出与基准图同尺寸的纯黑白 PNG', async () => {
    const base = await solid(600, 700, 255)
    const mask = await halfMask(600, 700)
    const prepared = await prepareEditMask(
      { data: base, mime: 'image/png' },
      { data: mask, mime: 'image/png' },
    )
    expect(prepared.mime).toBe('image/png')
    expect(prepared.width).toBe(600)
    expect(prepared.height).toBe(700)
    const { data, info } = await sharp(prepared.data).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBeGreaterThanOrEqual(3)
    // 灰度区域被二值化成纯白或纯黑，不能留灰边
    const values = new Set<number>()
    for (let index = 0; index < data.length; index += info.channels) {
      values.add(data[index] as number)
      values.add(data[index + 1] as number)
      values.add(data[index + 2] as number)
      if (info.channels === 4) values.add(data[index + 3] as number)
    }
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255])
  })
  it('蒙版尺寸不一致时按基准图拉伸', async () => {
    const base = await solid(600, 600, 255)
    const mask = await solid(300, 300, 255)
    const prepared = await prepareEditMask(
      { data: base, mime: 'image/png' },
      { data: mask, mime: 'image/png' },
    )
    expect(prepared.width).toBe(600)
    expect(prepared.height).toBe(600)
  })
  it('尺寸超出官方范围或图片无法解析时拒绝', async () => {
    const small = await solid(100, 100, 255)
    await expect(
      prepareEditMask({ data: small, mime: 'image/png' }, { data: small, mime: 'image/png' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const big = await solid(MASK_MAX_SIDE + 10, 600, 255)
    await expect(
      prepareEditMask({ data: big, mime: 'image/png' }, { data: big, mime: 'image/png' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      prepareEditMask(
        { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
        { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(MASK_MIN_SIDE).toBe(512)
  })
})

describe('prepareImageEditRequest（蒙版处理 + 上传）', () => {
  it('处理蒙版后把两张图传到临时 OSS，再拼请求体', async () => {
    const base = await solid(600, 600, 255)
    const mask = await halfMask(600, 600)
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/uploads?action=getPolicy'))
        return Response.json({
          data: {
            upload_host: 'https://oss.example.com',
            upload_dir: 'tmp/modelbay',
            oss_access_key_id: 'id',
            signature: 'sig',
            policy: 'policy',
            x_oss_object_acl: 'private',
            x_oss_forbid_overwrite: 'true',
          },
        })
      return new Response('', { status: 200 })
    })
    const ctx: AdapterContext = {
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      secret: () => 'key',
      signal: new AbortController().signal,
      log: vi.fn(),
      assets: {
        load: vi.fn(async (id: string) =>
          id === 'base' ? { data: base, mime: 'image/png' } : { data: mask, mime: 'image/png' },
        ),
      },
    }
    const body = await prepareImageEditRequest(ctx, {
      image: { assetId: 'base', kind: 'image' },
      mask: { assetId: 'mask', kind: 'image' },
      prompt: '把衣服换成红色',
      seed: 3,
    })
    expect(body).toMatchObject({
      model: 'wanx2.1-imageedit',
      input: {
        function: 'description_edit_with_mask',
        prompt: '把衣服换成红色',
      },
      parameters: { n: 1, seed: 3 },
    })
    const input = (body as { input: Record<string, string> }).input
    expect(input.base_image_url).toMatch(/^oss:\/\/tmp\/modelbay\/.+\.png$/)
    expect(input.mask_image_url).toMatch(/^oss:\/\/tmp\/modelbay\/.+\.png$/)
    const urls = fetchImpl.mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('/uploads?action=getPolicy'))).toBe(true)
    expect(urls.some((url) => url.includes('oss.example.com'))).toBe(true)
  })
})
