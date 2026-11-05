import { describe, expect, it } from 'vite-plus/test'
import type { AdapterContext } from '@modelbay/core'
import { createArkAdapter, createArkPlanAdapter, models } from '../src/index'
import { uploadReferenceVideo } from '../src/node/tos'
import { fakeContext, jsonResponse } from './helpers'

const image = { assetId: 'image-1', kind: 'image' as const }
const video = { assetId: 'video-1', kind: 'video' as const }
const audio = { assetId: 'audio-1', kind: 'audio' as const }

const MODEL = 'ark:doubao-seedance-2-0-260128'

/** 三种素材各返回一份假字节；不上传时不会真的发网络请求。 */
function fakeAssets(): AdapterContext['assets'] {
  return {
    load: async (id: string) => {
      if (id === 'image-1') return { data: new Uint8Array([1, 2, 3]), mime: 'image/png' }
      if (id === 'video-1') return { data: new Uint8Array([4, 5, 6]), mime: 'video/mp4' }
      return { data: new Uint8Array([7, 8, 9]), mime: 'audio/mpeg' }
    },
  }
}

/** 取 content 里的素材地址（如 `image_url.url`）。 */
function urlOf(item: Record<string, unknown> | undefined, key: string): string {
  const holder = item?.[key] as { url?: string } | undefined
  return holder?.url ?? ''
}

describe('方舟参考视频：注入后走通', () => {
  it('视频参考先上传再进 video_url，图片与音频按类别分流', async () => {
    const uploaded: Array<{ data: Uint8Array; mime: string }> = []
    const adapter = createArkAdapter(models, {
      uploadVideo: async (_ctx, file) => {
        uploaded.push(file)
        return 'https://test-bucket.tos-cn-beijing.volces.com/refs/x.mp4?sig=1'
      },
    })
    const { ctx, fetch, body } = fakeContext([jsonResponse({ id: 'accepted' })], {
      secret: { ARK_API_KEY: 'test-secret' },
      assets: fakeAssets(),
    })
    const result = await adapter.submit(
      {
        capability: 'video.generate',
        model: MODEL,
        input: {
          prompt: '@图片1 参考 @video1 运镜和 @audio1',
          references: [image, video, audio],
        },
      },
      ctx,
    )
    expect(result).toMatchObject({ state: 'pending', remoteId: 'accepted' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const content = body().content as Array<Record<string, unknown>>
    expect(content.map((item) => item.role)).toEqual([
      undefined,
      'reference_image',
      'reference_video',
      'reference_audio',
    ])
    expect(content[0]?.text).toBe('@image1 参考 @video1 运镜和 @audio1')
    expect(urlOf(content[1], 'image_url')).toMatch(/^data:image\/png;base64,/)
    expect(urlOf(content[2], 'video_url')).toBe(
      'https://test-bucket.tos-cn-beijing.volces.com/refs/x.mp4?sig=1',
    )
    expect(urlOf(content[2], 'video_url')).not.toContain('data:')
    expect(urlOf(content[3], 'audio_url')).toMatch(/^data:audio\/mp3;base64,/)
    // 上传拿到的是素材字节，不是 data URL。
    expect(uploaded).toHaveLength(1)
    expect(uploaded[0]?.mime).toBe('video/mp4')
    expect([...(uploaded[0]?.data ?? [])]).toEqual([4, 5, 6])
  })

  it('套餐渠道用同一套注入点，请求仍走套餐数据面', async () => {
    const adapter = createArkPlanAdapter(models, {
      uploadVideo: async () => 'https://test-bucket.tos-cn-beijing.volces.com/refs/y.mp4',
    })
    const { ctx, body } = fakeContext([jsonResponse({ id: 'plan-task' })], {
      secret: { ARK_AGENT_PLAN_API_KEY: 'plan-secret' },
      assets: fakeAssets(),
    })
    await adapter.submit(
      {
        capability: 'video.generate',
        model: 'ark-plan:doubao-seedance-2.0',
        input: { prompt: '运镜', references: [video] },
      },
      ctx,
    )
    const content = body().content as Array<Record<string, unknown>>
    // 第一项是文本提示词，第二项才是视频参考。
    expect(content[1]?.role).toBe('reference_video')
    expect(urlOf(content[1], 'video_url')).toBe(
      'https://test-bucket.tos-cn-beijing.volces.com/refs/y.mp4',
    )
  })
})

describe('方舟参考视频：没注入时报错', () => {
  it('缺上传实现时报 invalid_input，并写清子路径与注入方式', async () => {
    const adapter = createArkAdapter(models)
    const { ctx, fetch } = fakeContext([], {
      secret: { ARK_API_KEY: 'test-secret' },
      assets: fakeAssets(),
    })
    const error = await adapter
      .submit(
        {
          capability: 'video.generate',
          model: MODEL,
          input: { prompt: '运镜', references: [video] },
        },
        ctx,
      )
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({ code: 'invalid_input' })
    expect((error as Error).message).toContain('@modelbay/ark/tos')
    expect((error as Error).message).toContain('uploadVideo')
    // 报错发生在提交之前，不会留下半个请求。
    expect(fetch).not.toHaveBeenCalled()
  })

  it('没有视频参考时不需要上传实现', async () => {
    const adapter = createArkAdapter(models)
    const { ctx } = fakeContext([jsonResponse({ id: 'accepted' })], {
      secret: { ARK_API_KEY: 'test-secret' },
      assets: fakeAssets(),
    })
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: MODEL,
          input: { prompt: '运镜', references: [image] },
        },
        ctx,
      ),
    ).resolves.toMatchObject({ state: 'pending' })
  })
})

describe('方舟参考视频：真实 TOS 上传（从 plein 搬来的断言）', () => {
  it('三类素材上传和引用编号', async () => {
    const adapter = createArkAdapter(models, { uploadVideo: uploadReferenceVideo })
    const { ctx, fetch, body } = fakeContext(
      [new Response(null, { status: 200 }), jsonResponse({ id: 'accepted' })],
      {
        secret: {
          ARK_API_KEY: 'test-secret',
          ARK_REFERENCE_STORAGE: 'tos',
          ARK_REFERENCE_BUCKET: 'test-bucket',
          ARK_REFERENCE_REGION: 'cn-beijing',
          ARK_TOS_ACCESS_KEY: 'ak',
          ARK_TOS_SECRET_KEY: 'sk',
        },
        assets: fakeAssets(),
      },
    )
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: MODEL,
          input: {
            prompt: '@图片1 参考 @video1 运镜和 @audio1',
            references: [image, video, audio],
          },
        },
        ctx,
      ),
    ).resolves.toMatchObject({ remoteId: 'accepted' })
    // 先 PUT 原件，再提交生成任务。
    expect(fetch).toHaveBeenCalledTimes(2)
    const content = body(1).content as Array<Record<string, unknown>>
    expect(content.map((item) => item.role)).toEqual([
      undefined,
      'reference_image',
      'reference_video',
      'reference_audio',
    ])
    expect(content[0]?.text).toBe('@image1 参考 @video1 运镜和 @audio1')
    expect(urlOf(content[2], 'video_url')).toMatch(
      /^https:\/\/test-bucket\.tos-cn-beijing\.volces\.com\//,
    )
    expect(urlOf(content[2], 'video_url')).not.toContain('data:')
    const [, submitInit] = fetch.mock.calls[1] as [string, RequestInit]
    expect(submitInit.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
  })
})
