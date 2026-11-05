import { describe, expect, it } from 'vite-plus/test'
import sharp from 'sharp'
import { createOpenAIAdapter, models } from '../src/index'
import { editMask } from '../src/node/mask'
import { fakeContext, jsonResponse } from './helpers'

const MODEL = 'openai:gpt-image-2.5-sunburst'

/** 每次都造新的应答：Response 的 body 只能读一次。 */
const imageReply = () => jsonResponse({ data: [{ b64_json: 'iVBORw0KGgo=' }] })

/** 取 images 里的图片地址。 */
function imageUrl(value: unknown): string {
  const list = value as Array<{ image_url?: string }>
  return list[0]?.image_url ?? ''
}

/** 取 mask 里的蒙版地址。 */
function maskUrl(value: unknown): string {
  const holder = value as { image_url?: string }
  return holder?.image_url ?? ''
}

/** 原图与蒙版各一份假字节。 */
function fakeAssets(): {
  load: (id: string) => Promise<{ data: Uint8Array; mime: string }>
} {
  return {
    load: async (id: string) => ({
      data: id === 'source' ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5, 6]),
      mime: 'image/png',
    }),
  }
}

describe('OpenAI 蒙版：注入后走通', () => {
  it('转换结果进请求体，图片与蒙版都是 PNG data URL', async () => {
    const seen: Array<{ source: string; mask: string }> = []
    const adapter = createOpenAIAdapter(models, {
      editMask: async (_ctx, input) => {
        seen.push({ source: input.source.mime, mask: input.mask.mime })
        return {
          original: { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
          mask: { data: new Uint8Array([4, 5, 6]), mime: 'image/png' },
          width: 2,
          height: 2,
        }
      },
    })
    const { ctx, fetch, body } = fakeContext([imageReply()], {
      secret: { OPENAI_API_KEY: 'k' },
      assets: fakeAssets(),
    })
    await adapter.submit(
      {
        capability: 'image.edit',
        model: MODEL,
        input: {
          prompt: '改天空',
          image: { assetId: 'source', kind: 'image' },
          mask: { assetId: 'mask', kind: 'image' },
        },
      },
      ctx,
    )
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(seen).toEqual([{ source: 'image/png', mask: 'image/png' }])
    expect(imageUrl(body().images)).toMatch(/^data:image\/png;base64,/)
    expect(maskUrl(body().mask)).toMatch(/^data:image\/png;base64,/)
  })
})

describe('OpenAI 蒙版：没注入时报错', () => {
  it('缺转换实现时报 invalid_input，并写清子路径与注入方式', async () => {
    const adapter = createOpenAIAdapter(models)
    const { ctx, fetch } = fakeContext([], {
      secret: { OPENAI_API_KEY: 'k' },
      assets: fakeAssets(),
    })
    const error = await adapter
      .submit(
        {
          capability: 'image.edit',
          model: MODEL,
          input: {
            prompt: '改天空',
            image: { assetId: 'source', kind: 'image' },
            mask: { assetId: 'mask', kind: 'image' },
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({ code: 'invalid_input' })
    expect((error as Error).message).toContain('@modelbay/openai/node')
    expect((error as Error).message).toContain('editMask')
    // 报错发生在联网之前，不会把语义相反的蒙版发出去。
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('OpenAI 蒙版：真实 alpha 转换', () => {
  it('蒙版白色转换为透明，黑色转换为不透明，原图转 PNG 且尺寸一致', async () => {
    const adapter = createOpenAIAdapter(models, { editMask })
    const original = await sharp({
      create: { width: 2, height: 1, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
    const mask = await sharp(Buffer.from([0, 255]), { raw: { width: 2, height: 1, channels: 1 } })
      .png()
      .toBuffer()
    const { ctx, body } = fakeContext([imageReply()], {
      secret: { OPENAI_API_KEY: 'k' },
      assets: {
        load: async (id: string) => ({
          data: id === 'source' ? original : mask,
          mime: 'image/png',
        }),
      },
    })
    await adapter.submit(
      {
        capability: 'image.edit',
        model: MODEL,
        input: {
          prompt: 'edit',
          image: { assetId: 'source', kind: 'image' },
          mask: { assetId: 'mask', kind: 'image' },
        },
      },
      ctx,
    )
    const converted = Buffer.from(maskUrl(body().mask).split(',')[1] ?? '', 'base64')
    const pixels = await sharp(converted).raw().toBuffer()
    expect([pixels[3], pixels[7]]).toEqual([255, 0])
    expect(imageUrl(body().images)).toMatch(/^data:image\/png;base64,/)
  })
})
