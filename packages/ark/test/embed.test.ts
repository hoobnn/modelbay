/**
 * 方舟多模态向量化（text.embed）：注入 fetch 断言请求路径和请求体，应答形状取自官方文档示例。
 */
import { describe, expect, it } from 'vite-plus/test'
import { arkAdapter, arkPlanAdapter } from '../src/index'
import { fakeContext } from './helpers'

const MODEL = 'ark:doubao-embedding-vision'
const embed = (model: string, input: Record<string, unknown>) =>
  ({ capability: 'text.embed', model, input }) as never

const embedded = {
  created: 1752133360,
  data: { embedding: [0.1, 0.2], object: 'embedding' },
  id: 'emb-1',
  model: 'doubao-embedding-vision-251215',
  object: 'list',
  usage: {
    prompt_tokens: 25,
    prompt_tokens_details: { image_tokens: 0, text_tokens: 25 },
    total_tokens: 25,
  },
}

describe('多模态向量化', () => {
  it('texts 走 /embeddings/multimodal，模型换成按量渠道的快照 ID，选项进请求体', async () => {
    const { ctx, fetch, body } = fakeContext([embedded])
    const result = await arkAdapter.submit(
      embed(MODEL, {
        texts: ['天很蓝'],
        extra: {
          dimensions: 1024,
          instructions: 'Target_modality: text.',
          sparse_embedding: { type: 'enabled' },
        },
      }),
      ctx,
    )
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
    )
    expect(body()).toEqual({
      model: 'doubao-embedding-vision-251215',
      input: [{ type: 'text', text: '天很蓝' }],
      dimensions: 1024,
      instructions: 'Target_modality: text.',
      sparse_embedding: { type: 'enabled' },
    })
    expect(result).toEqual({
      state: 'succeeded',
      outputs: [
        {
          type: 'json',
          value: {
            id: 'emb-1',
            model: 'doubao-embedding-vision-251215',
            data: embedded.data,
            usage: embedded.usage,
          },
        },
      ],
      usage: { inputTokens: 25 },
    })
  })

  it('texts + images + videos 按文本、图片、视频顺序拼接', async () => {
    const { ctx, body } = fakeContext([embedded])
    await arkAdapter.submit(
      embed(MODEL, {
        texts: ['视频和图片里有什么'],
        images: ['https://example.com/a.png', 'data:image/png;base64,AAAA'],
        videos: ['https://example.com/v.mp4'],
      }),
      ctx,
    )
    expect(body().input).toEqual([
      { type: 'text', text: '视频和图片里有什么' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'video_url', video_url: { url: 'https://example.com/v.mp4' } },
    ])
  })

  it('contents：官方结构原样放行（含视频抽帧参数），简写换成官方结构', async () => {
    const { ctx, body } = fakeContext([embedded])
    const video = {
      type: 'video_url',
      video_url: {
        url: 'https://example.com/v.mp4',
        fps: 1,
        max_video_tokens: 120000,
        min_frames: 10,
      },
    }
    await arkAdapter.submit(
      embed(MODEL, {
        contents: [
          video,
          { text: '猫' },
          { image: 'https://example.com/cat.png' },
          { video: 'https://example.com/b.mp4' },
        ],
        extra: { multi_embedding: { type: 'enabled', compression: 'zstd' } },
      }),
      ctx,
    )
    expect(body().input).toEqual([
      video,
      { type: 'text', text: '猫' },
      { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
      { type: 'video_url', video_url: { url: 'https://example.com/b.mp4' } },
    ])
    expect(body().multi_embedding).toEqual({ type: 'enabled', compression: 'zstd' })
  })

  it('输入和选项不合法时在联网前报 invalid_input', async () => {
    const bad: Array<Record<string, unknown>> = [
      {},
      { texts: [] },
      { texts: ['a'], contents: [{ text: 'b' }] },
      { texts: [''] },
      { contents: [{ type: 'audio_url' }] },
      { contents: [{ foo: 1 }] },
      { images: ['/Users/me/a.png'] },
      { texts: ['a'], extra: { dimensions: 512 } },
      { texts: ['a'], extra: { multi_embedding: {} } },
      { texts: ['a'], extra: { model: 'hacked' } },
      { texts: ['a'], extra: { encoding_format: 'null' } },
    ]
    for (const input of bad) {
      const { ctx, fetch } = fakeContext([])
      await expect(arkAdapter.submit(embed(MODEL, input), ctx)).rejects.toMatchObject({
        code: 'invalid_input',
      })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('没有指定模型、套餐渠道、不支持向量化的模型都拒绝', async () => {
    for (const [adapter, model] of [
      [arkAdapter, ''],
      [arkPlanAdapter, 'ark-plan:doubao-embedding-vision'],
      [arkAdapter, 'ark:doubao-seed-2-1-pro-260915'],
    ] as const) {
      const { ctx, fetch } = fakeContext([], { secret: 'k' })
      await expect(adapter.submit(embed(model, { texts: ['a'] }), ctx)).rejects.toMatchObject({
        code: 'invalid_input',
      })
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('HTTP 错误按状态归类，应答缺少 data 报 unknown', async () => {
    await expect(
      arkAdapter.submit(
        embed(MODEL, { texts: ['a'] }),
        fakeContext([
          Response.json({ error: { code: 'AuthenticationError', message: 'no' } }, { status: 401 }),
        ]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'auth' })
    await expect(
      arkAdapter.submit(embed(MODEL, { texts: ['a'] }), fakeContext([{ id: 'x' }]).ctx),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})
