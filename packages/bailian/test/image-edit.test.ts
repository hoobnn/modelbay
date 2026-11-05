import { describe, expect, it } from 'vite-plus/test'
import { vi } from 'vite-plus/test'
import type { AdapterContext } from '@modelbay/core'
import sharp from 'sharp'
import { createBailianAdapter } from '../src/adapter'
import { prepareImageEditRequest, prepareImageProcessRequest } from '../src/node/image-edit'
import { all as bailianModels } from '../src/models/index'

const MODEL = 'wanx2.1-imageedit'

/** 百炼的临时 OSS 上传策略。 */
function policy() {
  return {
    data: {
      upload_host: 'https://oss.example.com',
      upload_dir: 'tmp',
      oss_access_key_id: 'id',
      signature: 'sig',
      policy: 'policy',
      x_oss_object_acl: 'private',
      x_oss_forbid_overwrite: 'true',
    },
  }
}

/** 按 URL 分流的假 fetch：策略请求、素材上传、生成提交各走各的分支。 */
function fakeCtx(
  opts: {
    taskId?: string
    assets?: (id: string) => Promise<{ data: Uint8Array; mime: string }>
  } = {},
) {
  const fetchImpl = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input)
    if (url.includes('/uploads?action=getPolicy')) return Response.json(policy())
    if (url.includes('oss.example.com')) return new Response('', { status: 200 })
    return Response.json({ output: { task_id: opts.taskId ?? 'edit/1', task_status: 'PENDING' } })
  })
  const ctx: AdapterContext = {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    secret: (name) => (name === 'BAILIAN_API_KEY' ? 'key' : undefined),
    signal: new AbortController().signal,
    log: vi.fn(),
    assets: {
      load: vi.fn(async (id: string) =>
        opts.assets ? opts.assets(id) : { data: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      ),
    },
  }
  return { ctx, fetch: fetchImpl }
}

/** 第 index 次请求的 URL、头与 JSON 请求体。 */
function call(fetchImpl: { mock: { calls: unknown[][] } }, index = 0) {
  const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit]
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  }
}

/** 一张 600×600 的纯白 PNG。 */
async function solid(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 600, height: 600, channels: 3, background: 'white' } })
      .png()
      .toBuffer(),
  )
}

describe('百炼局部重绘：注入后走通', () => {
  it('注入后走真实请求体，异步提交并返回 task_id', async () => {
    const adapter = createBailianAdapter(bailianModels, { edit: prepareImageEditRequest })
    const { ctx, fetch } = fakeCtx({
      assets: async () => ({ data: await solid(), mime: 'image/png' }),
    })
    const result = await adapter.submit(
      {
        capability: 'image.edit',
        model: MODEL,
        input: {
          prompt: '把杯子换成红色',
          image: { assetId: 'img', kind: 'image' },
          mask: { assetId: 'mask', kind: 'image' },
          count: 1,
        },
      },
      ctx,
    )
    expect(result).toMatchObject({ state: 'pending', remoteId: 'edit/1' })
    const submitted = call(fetch, fetch.mock.calls.length - 1)
    expect(submitted.url).toMatch(/image2image\/image-synthesis$/)
    expect(submitted.headers['X-DashScope-Async']).toBe('enable')
    expect(submitted.headers['X-DashScope-OssResourceResolve']).toBe('enable')
    expect(submitted.body.model).toBe(MODEL)
    expect(submitted.body.input).toMatchObject({
      function: 'description_edit_with_mask',
      prompt: '把杯子换成红色',
      base_image_url: expect.stringMatching(/^oss:\/\/tmp\//),
      mask_image_url: expect.stringMatching(/^oss:\/\/tmp\//),
    })
    expect((submitted.body.parameters as { n: number }).n).toBe(1)
  })

  it('没注入时报 invalid_input，并写清子路径与注入方式', async () => {
    const adapter = createBailianAdapter(bailianModels)
    const { ctx, fetch } = fakeCtx()
    const error = await adapter
      .submit(
        {
          capability: 'image.edit',
          model: MODEL,
          input: {
            prompt: '把杯子换成红色',
            image: { assetId: 'img', kind: 'image' },
            mask: { assetId: 'mask', kind: 'image' },
          },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({ code: 'invalid_input' })
    expect((error as Error).message).toContain('@modelbay/bailian/node')
    expect((error as Error).message).toContain('prepareImageEditRequest')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('请求多张时在上传素材前拒绝', async () => {
    let prepared = 0
    const adapter = createBailianAdapter(bailianModels, {
      edit: async (_ctx, opts) => {
        prepared += 1
        return { model: opts.model, input: {}, parameters: { n: opts.count ?? 1 } }
      },
    })
    const { ctx, fetch } = fakeCtx()
    await expect(
      adapter.submit(
        {
          capability: 'image.edit',
          model: MODEL,
          input: {
            prompt: '把杯子换成红色',
            image: { assetId: 'img', kind: 'image' },
            mask: { assetId: 'mask', kind: 'image' },
            count: 2,
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(prepared).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('百炼精修：注入后走通', () => {
  it('AI 放大走 super_resolution，扩图走 expand', async () => {
    const adapter = createBailianAdapter(bailianModels, { process: prepareImageProcessRequest })
    const { ctx, fetch } = fakeCtx({ taskId: 'up/1' })
    await adapter.submit(
      {
        capability: 'image.process',
        model: MODEL,
        input: {
          image: { assetId: 'img', kind: 'image' },
          operation: 'upscale',
          scale: 3,
        },
      },
      ctx,
    )
    const submitted = call(fetch, fetch.mock.calls.length - 1)
    expect(submitted.url).toMatch(/image2image\/image-synthesis$/)
    expect(submitted.headers['X-DashScope-Async']).toBe('enable')
    expect(submitted.headers['X-DashScope-OssResourceResolve']).toBe('enable')
    expect(submitted.body.input).toMatchObject({
      function: 'super_resolution',
      base_image_url: expect.stringMatching(/^oss:\/\/tmp\//),
    })
    expect(submitted.body.parameters).toMatchObject({ n: 1, upscale_factor: 3 })
  })

  it('扩图四边比例都进请求体', async () => {
    const adapter = createBailianAdapter(bailianModels, { process: prepareImageProcessRequest })
    const { ctx, fetch } = fakeCtx({ taskId: 'out/1' })
    await adapter.submit(
      {
        capability: 'image.process',
        model: MODEL,
        input: {
          image: { assetId: 'img', kind: 'image' },
          operation: 'outpaint',
          expansion: { top: 1, bottom: 2, left: 1.5, right: 1.25 },
        },
      },
      ctx,
    )
    const submitted = call(fetch, fetch.mock.calls.length - 1)
    expect(submitted.body.input).toMatchObject({
      function: 'expand',
      base_image_url: expect.stringMatching(/^oss:\/\/tmp\//),
    })
    expect(submitted.body.parameters).toMatchObject({
      n: 1,
      top_scale: 1,
      bottom_scale: 2,
      left_scale: 1.5,
      right_scale: 1.25,
    })
  })

  it('缺值时用声明里的默认值：放大 2 倍、扩图各边 1/1/1.5/1.5', async () => {
    const adapter = createBailianAdapter(bailianModels, { process: prepareImageProcessRequest })
    const { ctx, fetch } = fakeCtx({ taskId: 'up/2' })
    await adapter.submit(
      {
        capability: 'image.process',
        model: MODEL,
        input: { image: { assetId: 'img', kind: 'image' }, operation: 'upscale' },
      },
      ctx,
    )
    let submitted = call(fetch, fetch.mock.calls.length - 1)
    expect(submitted.body.parameters).toMatchObject({ n: 1, upscale_factor: 2 })

    const { ctx: outCtx, fetch: outFetch } = fakeCtx({ taskId: 'out/2' })
    await adapter.submit(
      {
        capability: 'image.process',
        model: MODEL,
        input: { image: { assetId: 'img', kind: 'image' }, operation: 'outpaint' },
      },
      outCtx,
    )
    submitted = call(outFetch, outFetch.mock.calls.length - 1)
    expect(submitted.body.parameters).toMatchObject({
      n: 1,
      top_scale: 1,
      bottom_scale: 1,
      left_scale: 1.5,
      right_scale: 1.5,
    })
  })

  it('精修不需要 sharp：没注入预处理实现时用内置的上传与请求体', async () => {
    const adapter = createBailianAdapter(bailianModels)
    const { ctx, fetch } = fakeCtx({ taskId: 'edit/1' })
    const result = await adapter.submit(
      {
        capability: 'image.process',
        model: MODEL,
        input: { image: { assetId: 'img', kind: 'image' }, operation: 'upscale', scale: 2 },
      },
      ctx,
    )
    expect(result).toMatchObject({ state: 'pending', remoteId: 'edit/1' })
    const submitted = call(fetch, fetch.mock.calls.length - 1)
    expect(submitted.body.parameters).toMatchObject({ n: 1, upscale_factor: 2 })
  })

  it('超出声明范围的倍数与比例在联网前拒绝', async () => {
    const adapter = createBailianAdapter(bailianModels, { process: prepareImageProcessRequest })
    const { ctx, fetch } = fakeCtx()
    await expect(
      adapter.submit(
        {
          capability: 'image.process',
          model: MODEL,
          input: { image: { assetId: 'img', kind: 'image' }, operation: 'upscale', scale: 9 },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      adapter.submit(
        {
          capability: 'image.process',
          model: MODEL,
          input: {
            image: { assetId: 'img', kind: 'image' },
            operation: 'outpaint',
            expansion: { top: 1, bottom: 1, left: 1.5, right: 5 },
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
