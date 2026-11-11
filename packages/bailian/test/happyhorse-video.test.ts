import { describe, expect, it } from 'vite-plus/test'
import { referenceLabelStyle, videoReferencePrompt } from '@modelbay/core'
import { createBailianAdapter } from '../src/adapter'
import { all as bailianModels } from '../src/models/index'
import { fakeContext, fixture } from './helpers'

const adapter = createBailianAdapter(bailianModels)
const image = (assetId: string) => ({ assetId, kind: 'image' as const })
const task = { output: { task_id: 'hh-1' } }
const upload = () => [fixture('upload-policy').response.body, new Response('', { status: 200 })]

describe('HappyHorse 1.1 视频生成', () => {
  it('文生视频：发 ratio，不发 audio，时长按声明 3–15 校验', async () => {
    const { ctx, body } = fakeContext([task])
    await adapter.submit(
      {
        capability: 'video.generate',
        model: 'happyhorse-1.1-t2v',
        input: { prompt: '海浪', duration: 3, audio: true },
      },
      ctx,
    )
    const sent = body(0) as { model: string; parameters: Record<string, unknown> }
    expect(sent.model).toBe('happyhorse-1.1-t2v')
    expect(sent.parameters).toMatchObject({ resolution: '1080P', ratio: '16:9', duration: 3 })
    expect(sent.parameters).not.toHaveProperty('audio')
    for (const duration of [2, 16, -1])
      await expect(
        adapter.submit(
          {
            capability: 'video.generate',
            model: 'happyhorse-1.1-t2v',
            input: { prompt: '海浪', duration },
          },
          fakeContext([]).ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('3–15') })
  })

  it('图生视频：只收首帧，提示词可空，不发 ratio', async () => {
    const { ctx, body } = fakeContext([...upload(), task])
    await adapter.submit(
      {
        capability: 'video.generate',
        model: 'happyhorse-1.1-i2v',
        input: { prompt: '', firstFrame: image('a'), aspectRatio: '9:16' },
      },
      ctx,
    )
    const sent = body(2) as { input: { media: unknown[] }; parameters: Record<string, unknown> }
    expect(sent.input.media).toEqual([{ type: 'first_frame', url: expect.any(String) }])
    expect(sent.parameters).not.toHaveProperty('ratio')
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-i2v',
          input: { prompt: '猫', references: [image('a')] },
        },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('不支持') })
  })

  it('参考生视频：@image1 换成 [Image 1]，最多 9 张图，不收视频参考', async () => {
    const { ctx, body } = fakeContext([...upload(), task])
    await adapter.submit(
      {
        capability: 'video.generate',
        model: 'happyhorse-1.1-r2v',
        input: { prompt: '@image1 里的女孩在跳舞', references: [image('a')] },
      },
      ctx,
    )
    const sent = body(2) as { input: { prompt: string; media: unknown[] } }
    expect(sent.input.prompt).toBe('[Image 1] 里的女孩在跳舞')
    expect(sent.input.media).toEqual([{ type: 'reference_image', url: expect.any(String) }])
    const many = Array.from({ length: 10 }, (_, i) => image(`i${i}`))
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-r2v',
          input: { prompt: '跳舞', references: many },
        },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('最多 9') })
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-r2v',
          input: { prompt: '跳舞', references: [{ assetId: 'v', kind: 'video' }] },
        },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('不支持 video 参考') })
    // 文生视频模型不收参考图
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-t2v',
          input: { prompt: '跳舞', references: [image('a')] },
        },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('宿主给出素材宽高（ctx.files）时按 minEdge 校验参考图', async () => {
    const ok = fakeContext([...upload(), task], { files: { width: 1024, height: 1024 } })
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-r2v',
          input: { prompt: '@image1 跳舞', references: [image('a')] },
        },
        ok.ctx,
      ),
    ).resolves.toMatchObject({ state: 'pending' })
    const small = fakeContext([], { files: { width: 300, height: 300 } })
    await expect(
      adapter.submit(
        {
          capability: 'video.generate',
          model: 'happyhorse-1.1-r2v',
          input: { prompt: '@image1 跳舞', references: [image('a')] },
        },
        small.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(small.calls()).toHaveLength(0)
  })

  it('万相 3.0 行为不变：-1 自适应时长、音频开关、图N 编号', async () => {
    const { ctx, body } = fakeContext([task])
    await adapter.submit(
      {
        capability: 'video.generate',
        model: 'wan3.0-video',
        input: { prompt: '海浪', duration: -1 },
      },
      ctx,
    )
    expect((body(0) as { parameters: object }).parameters).toMatchObject({
      duration: -1,
      audio: true,
      ratio: '16:9',
    })
    expect(videoReferencePrompt('@image2', 'bailian')).toBe('图2')
    expect(referenceLabelStyle('video.generate', 'aliyun/bailian', 'happyhorse-1.1-r2v')).toBe(
      'happyhorse-video',
    )
    expect(referenceLabelStyle('video.generate', 'aliyun/bailian', 'wan3.0-video')).toBe(
      'bailian-video',
    )
  })
})
