import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import { buildImageEditRequest, IMAGE_EDIT_PATH, imageEditNodeOnly } from '../src/node/image-edit'

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
  it('marks the sharp uploader as a TODO', () => {
    expect(() => imageEditNodeOnly()).toThrow(ProviderError)
  })
})
