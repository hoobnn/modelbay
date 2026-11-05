import { describe, expect, it } from 'vite-plus/test'
import { buildImageBody, buildEditBody, parseImageResponse } from '../src/media'
import { fakeContext } from './helpers'

const model = 'gpt-image-2.6-sunburst'
const ref = { assetId: 'source', kind: 'image' as const }
const context = () =>
  fakeContext([], {
    assets: { load: async () => ({ data: new Uint8Array([1]), mime: 'image/png' }) },
  }).ctx

describe('GPT Image 2.6 请求与返回', () => {
  it('GIF 参数、SVG MIME 与 token 用量', async () => {
    const built = await buildImageBody(
      model,
      {
        prompt: 'Looping cat',
        extra: {
          output_format: 'gif',
          complexity: 'low',
          frame_count: 16,
          frame_duration_ms: 150,
          moderation: 'auto',
          safety_identifier: 'hash',
        },
      },
      context(),
      'OpenAI',
    )
    expect(built.body).toMatchObject({
      output_format: 'gif',
      complexity: 'low',
      frame_count: 16,
      frame_duration_ms: 150,
    })
    const result = parseImageResponse(
      {
        data: [{ b64_json: 'AQ==' }],
        usage: { input_tokens: 2, output_tokens: 3 },
        svg_usage: { input_tokens: 4, output_tokens: 5 },
      },
      'svg',
    )
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ mime: 'image/svg+xml', data: new Uint8Array([1]) }],
      usage: { images: 1, inputTokens: 6, outputTokens: 8 },
    })
    expect(parseImageResponse({ data: [{ b64_json: 'AQ==' }] }, 'gif')).toMatchObject({
      outputs: [{ mime: 'image/gif' }],
    })
  })

  it('参考图编辑保留指定尺寸、压缩和 markup', async () => {
    const built = await buildImageBody(
      model,
      {
        prompt: 'Recolor vase',
        references: [ref],
        width: 1536,
        height: 864,
        extra: {
          output_format: 'webp',
          output_compression: 70,
          markup: { file_id: 'file_overlay' },
        },
      },
      context(),
      'OpenAI',
    )
    expect(built).toMatchObject({
      edit: true,
      body: { size: '1536x864', output_compression: 70, markup: { file_id: 'file_overlay' } },
    })
    const explicit = await buildImageBody(
      'gpt-image-2.5-flare',
      { prompt: 'cat', extra: { size: '1536x864' } },
      context(),
      'OpenAI',
    )
    expect(explicit.body.size).toBe('1536x864')
  })

  it.each([
    { output_format: 'svg', count: 2 },
    { output_format: 'gif', references: [ref] },
    { output_format: 'svg', references: [ref] },
    { output_format: 'gif', frame_count: 17 },
    { frame_count: 9 },
    { svg: { model: 'gpt-6.1-sol' } },
    { complexity: 'invalid' },
    { output_compression: 20 },
    { output_format: 'jpeg', output_compression: 101 },
    { markup: { file_id: 'file_1' } },
    { references: [ref], markup: { file_id: 'file_1', image_url: 'https://example.com/x.png' } },
    { output_format: 'svg', background: 'transparent' },
    { stream: true },
    { size: '10x10' },
  ])('发送前拒绝不支持的格式组合 %j', async ({ count, references, ...extra }) => {
    await expect(
      buildImageBody(model, { prompt: 'cat', count, references, extra }, context(), 'OpenAI'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('旧模型不接受新模型参数格式；声明尺寸上限对显式 size 同样生效', async () => {
    await expect(
      buildImageBody(
        'gpt-image-2.5-sunburst',
        { prompt: 'cat', extra: { output_format: 'gif' } },
        context(),
        'OpenAI',
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      buildImageBody(
        'gpt-image-2.5-sunburst',
        { prompt: 'cat', extra: { size: '4096x1024' } },
        context(),
        'OpenAI',
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('蒙版编辑与 markup 互斥', async () => {
    await expect(
      buildEditBody(
        model,
        { prompt: 'cat', image: ref, mask: ref, extra: { markup: { file_id: 'file_1' } } },
        context(),
        'OpenAI',
        async (_ctx, { source, mask }) => ({ original: source, mask, width: 1, height: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('空 base64 不会被当成成功', () => {
    expect(() => parseImageResponse({ data: [{ b64_json: '' }] }, 'png')).toThrow(
      expect.objectContaining({ outcome: 'unknown', retryable: false }),
    )
  })
})
