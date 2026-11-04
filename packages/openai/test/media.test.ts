import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type CapabilityInput } from '@modelbay/core'
import {
  buildEditBody,
  buildImageBody,
  imageSize,
  openAiModelList,
  parseImageResponse,
} from '../src/media'
import { fakeContext, fixture, type RecordedCall } from './helpers'

function ctx() {
  return fakeContext([], {
    assets: {
      load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }),
    },
  }).ctx
}

describe('imageSize：画幅与尺寸换算', () => {
  it('默认 auto 与常见画幅', () => {
    expect(imageSize({ prompt: 'x' })).toBe('auto')
    expect(imageSize({ prompt: 'x', extra: { aspectRatio: '16:9' } })).toBe('1536x864')
    expect(imageSize({ prompt: 'x', extra: { aspectRatio: '1:1' } })).toBe('1024x1024')
  })

  it('显式宽高合法 / 非法', () => {
    expect(imageSize({ prompt: 'x', width: 1024, height: 1024 })).toBe('1024x1024')
    expect(() => imageSize({ prompt: 'x', width: 100, height: 100 })).toThrow(ProviderError)
    expect(() => imageSize({ prompt: 'x', extra: { aspectRatio: '7:3' } })).toThrow(ProviderError)
  })
})

describe('buildImageBody：图片请求构造', () => {
  it('与录制夹具一致', async () => {
    const recorded = fixture<RecordedCall>('image-success')
    const built = await buildImageBody(
      'gpt-image-2-5-sunburst',
      { prompt: '一只猫' },
      ctx(),
      'OpenAI',
    )
    expect(built.body).toEqual(recorded.request.body)
    expect(built.format).toBe('png')
    expect(built.edit).toBe(false)
  })

  it('参考图切换到 edits 端点并转 data URL', async () => {
    const built = await buildImageBody(
      'gpt-image-2-5-sunburst',
      {
        prompt: '猫',
        references: [{ assetId: 'a1', kind: 'image' }],
        extra: { quality: 'high', output_format: 'webp' },
      },
      ctx(),
      'OpenAI',
    )
    expect(built.edit).toBe(true)
    expect(built.format).toBe('webp')
    expect(built.body.images).toEqual([{ image_url: 'data:image/png;base64,AQID' }])
    expect(built.body.size).toBeUndefined()
  })

  it('参数校验', async () => {
    await expect(
      buildImageBody('m', { prompt: 'x', extra: { output_format: 'gif' } }, ctx(), 'OpenAI'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      buildImageBody(
        'm',
        { prompt: 'x', extra: { output_format: 'jpeg', background: 'transparent' } },
        ctx(),
        'OpenAI',
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(buildImageBody('m', { prompt: '' }, ctx(), 'OpenAI')).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      buildImageBody(
        'm',
        {
          prompt: 'x',
          references: Array.from({ length: 17 }, () => ({ assetId: 'a', kind: 'image' as const })),
        },
        ctx(),
        'OpenAI',
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('buildEditBody：蒙版编辑请求', () => {
  it('原图与蒙版转成 images / mask', async () => {
    const built = await buildEditBody(
      'gpt-image-2-5-sunburst',
      {
        image: { assetId: 'src', kind: 'image' },
        mask: { assetId: 'mask', kind: 'image' },
        prompt: '改天空',
      },
      ctx(),
      'OpenAI',
    )
    expect(built.edit).toBe(true)
    expect(built.body.images).toEqual([{ image_url: 'data:image/png;base64,AQID' }])
    expect(built.body.mask).toEqual({ image_url: 'data:image/png;base64,AQID' })
  })

  it('缺原图或蒙版报错', async () => {
    const input = { image: { assetId: 'src', kind: 'image' } } as CapabilityInput<'image.edit'>
    await expect(buildEditBody('m', input, ctx(), 'OpenAI')).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('parseImageResponse：图片响应解析', () => {
  it('与录制夹具一致', () => {
    const recorded = fixture<RecordedCall>('image-success')
    const result = parseImageResponse(recorded.response.body as Record<string, unknown>, 'png')
    expect(result.state).toBe('succeeded')
    if (result.state === 'succeeded') {
      expect(result.outputs).toHaveLength(2)
      expect(result.outputs[0]).toMatchObject({ type: 'file', kind: 'image', mime: 'image/png' })
      expect(result.usage).toEqual({ images: 2 })
    }
  })

  it('空 / 非法 base64 抛 unknown', () => {
    expect(() => parseImageResponse({}, 'png')).toThrow(ProviderError)
    expect(() => parseImageResponse({ data: [{ b64_json: '!!!' }] }, 'png')).toThrow(ProviderError)
  })
})

describe('openAiModelList：模型列表解析', () => {
  it('归一化并过滤空 id', () => {
    const recorded = fixture<RecordedCall>('model-list')
    expect(openAiModelList(recorded.response.body)).toEqual([
      { id: 'gpt-6-1-sol', ownedBy: 'openai', created: 1760000000 },
      { id: 'gpt-image-2-5-sunburst' },
    ])
    expect(() => openAiModelList({})).toThrow(ProviderError)
  })
})
