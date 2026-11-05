import { describe, expect, it } from 'vite-plus/test'
import { ProviderError, type CapabilityInput } from '@modelbay/core'
import {
  cancelVideo,
  cutoutBody,
  imageBody,
  openAiModelList,
  parseCutoutResponse,
  parseImageResponse,
  parseTaskStatus,
  pollVideo,
  ratioOf,
  sizeByArea,
  submitVideo,
  tierEdge,
  videoBody,
  type TaskOptions,
} from '../src/media'
import type { TransportMessages } from '../src/http'
import { allModels as all } from '../src/declarations'
import type { ModelLimits } from '@modelbay/core'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

const messages: TransportMessages = {
  cancelled: '火山方舟请求已取消',
  network: '火山方舟网络请求失败；生成提交结果可能未知，不会自动重新提交',
}

function ctx(assets = true) {
  return fakeContext([], {
    ...(assets
      ? {
          assets: {
            load: async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }),
          },
        }
      : {}),
  }).ctx
}

/** videoBody 的简写：无声明上限、默认 720p。 */
function vb(
  plane: 'api' | 'plan',
  model: string,
  input: CapabilityInput<'video.generate'>,
  limits: ModelLimits = {},
) {
  return videoBody({ plane, model, input, ctx: ctx(), defaultResolution: '720p', limits })
}

function taskOptions(replies: Parameters<typeof fakeContext>[0]): TaskOptions {
  const { ctx: context } = fakeContext(replies)
  return {
    ctx: context,
    plane: 'api',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    key: 'sk-recorded-key',
    label: '火山方舟',
    messages,
  }
}

describe('尺寸与模型名工具', () => {
  it('ratioOf / sizeByArea / tierEdge', () => {
    expect(ratioOf('16:9')).toBeCloseTo(16 / 9)
    expect(ratioOf('bad')).toBe(1)
    expect(sizeByArea('1:1', 1024 * 1024)).toEqual({ width: 1024, height: 1024 })
    expect(tierEdge('2K')).toBe(2048)
    expect(tierEdge('1.5K')).toBe(1536)
    expect(tierEdge('bad')).toBeUndefined()
  })
})

/** 声明里的上限：测试与运行时读同一份声明。 */
function limitsOf(canonicalId: string): ModelLimits {
  const found = all.find((item) => item.canonicalId === canonicalId)
  if (!found) throw new Error(`缺少声明 ${canonicalId}`)
  return found.limits ?? {}
}

const PRO = limitsOf('volc/doubao-seedream-5-0-pro-260628')
const LITE = limitsOf('volc/doubao-seedream-5-0-260128')

describe('imageBody：图片请求构造', () => {
  const base: CapabilityInput<'image.generate'> = { prompt: '一只猫' }

  it('默认档位换算成 WxH，并带上 response_format', async () => {
    const recorded = fixture<RecordedCall>('image-success')
    const body = await imageBody('doubao-seedream-5-0-pro-260628', base, ctx(), PRO, '2K')
    expect(body).toEqual(recorded.request.body)
  })

  it('显式宽高与分辨率档位', async () => {
    const explicit = await imageBody(
      'doubao-seedream-5-0-pro-260628',
      { prompt: '猫', width: 1280, height: 1024 },
      ctx(),
      PRO,
      '2K',
    )
    expect(explicit.size).toBe('1280x1024')
    const auto = await imageBody(
      'doubao-seedream-5-0-pro-260628',
      { prompt: '猫', extra: { aspectRatio: 'auto' } },
      ctx(),
      PRO,
      '2K',
    )
    expect(auto.size).toBe('2K')
  })

  it('多图走 sequential_image_generation，参考图转 data URL', async () => {
    const body = await imageBody(
      'doubao-seedream-5-0-260128',
      {
        prompt: '组图',
        count: 3,
        references: [{ assetId: 'a1', kind: 'image' }],
      },
      ctx(),
      LITE,
      '2K',
    )
    expect(body.sequential_image_generation).toBe('auto')
    expect(body.sequential_image_generation_options).toEqual({ max_images: 3 })
    expect(body.image).toBe('data:image/png;base64,AQID')
  })

  it('非法输入的校验', async () => {
    await expect(imageBody('m', { prompt: '' }, ctx(), PRO, '2K')).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      imageBody('doubao-seedream-5-0-pro-260628', { prompt: '猫', count: 2 }, ctx(), PRO, '2K'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      imageBody('m', { prompt: '猫', negativePrompt: '丑' }, ctx(), PRO, '2K'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      imageBody('m', { prompt: '猫', extra: { notAllowed: 1 } }, ctx(), PRO, '2K'),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('parseImageResponse：图片响应解析', () => {
  it('b64_json 与 URL 都转成 file 输出', () => {
    const recorded = fixture<RecordedCall>('image-success')
    const result = parseImageResponse(recorded.response.body as Record<string, unknown>)
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toMatchObject({ type: 'file', kind: 'image', mime: 'image/png' })
    expect(result.outputs[1]).toMatchObject({
      type: 'file',
      mime: 'image/jpeg',
      url: 'https://ark-recorded.volces.com/image/2.png',
    })
    expect(result.usage).toEqual({ images: 2 })
  })

  it('缺图 / 业务错误 / 非法 base64', () => {
    expect(() => parseImageResponse({})).toThrow(ProviderError)
    expect(() => parseImageResponse({ data: [{ error: { code: 'x' } }] })).toThrow(ProviderError)
    expect(() => parseImageResponse({ data: [{ b64_json: '!!!' }] })).toThrow(ProviderError)
  })

  it('非法产物 URL 被拒绝', () => {
    expect(() => parseImageResponse({ data: [{ url: 'http://evil.test/x.png' }] })).toThrow(
      /无效产物 URL|缺少产物 URL|下载域名/,
    )
  })
})

describe('cutoutBody / parseCutoutResponse：图层抠图', () => {
  it('请求带 layer_decomposition 与原图 data URL', async () => {
    const body = await cutoutBody(
      'doubao-seedream-5-0-pro-260628',
      { image: { assetId: 'a1', kind: 'image' }, operation: 'cutout', prompt: '抠图' },
      ctx(),
    )
    expect(body.layer_decomposition).toBe(true)
    expect(body.image).toBe('data:image/png;base64,AQID')
    await expect(
      cutoutBody('m', { image: { assetId: 'a1', kind: 'image' }, operation: 'upscale' }, ctx()),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('图层结果含透明 PNG 与元数据', () => {
    const result = parseCutoutResponse({
      data: [
        { z_index: 0, name: '背景' },
        { z_index: 1, b64_json: 'iVBORw0KGgo=', bounding_box: { absolute: [0, 0, 1, 1] } },
      ],
    })
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toMatchObject({ type: 'file', mime: 'image/png' })
    expect(result.outputs[1]).toMatchObject({ type: 'json' })
  })

  it('无效图层顺序 / 空结果', () => {
    expect(() => parseCutoutResponse({ data: [{ z_index: 1 }, { z_index: 1 }] })).toThrow(
      ProviderError,
    )
    expect(() => parseCutoutResponse({ data: [] })).toThrow(ProviderError)
  })
})

describe('videoBody：视频请求构造', () => {
  it('与录制夹具一致', async () => {
    const recorded = fixture<RecordedCall>('video-submit')
    const body = await vb('api', 'doubao-seedance-2-0-260128', {
      prompt: '海浪拍岸',
      audio: true,
      resolution: '720p',
      aspectRatio: '16:9',
    })
    expect(body).toEqual(recorded.request.body)
  })

  it('首尾帧与参考图互斥等校验', async () => {
    await expect(
      vb('api', 'm', { prompt: '', firstFrame: { assetId: 'a', kind: 'image' } }),
    ).resolves.toMatchObject({ ratio: 'adaptive' })
    await expect(
      vb('api', 'm', { prompt: 'x', lastFrame: { assetId: 'a', kind: 'image' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(vb('api', 'm', { prompt: '' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(vb('plan', 'm', { prompt: 'x', extra: { draft: true } })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('异步任务：提交 / 轮询 / 取消', () => {
  it('提交返回 pending + remoteId + pollAfterMs', async () => {
    const recorded = fixture<RecordedCall>('video-submit')
    const opts = taskOptions([jsonResponse(recorded.response.body, recorded.response.status)])
    const result = await submitVideo(recorded.request.body as Record<string, unknown>, opts)
    expect(result).toEqual({
      state: 'pending',
      remoteId: 'cgt-2026-recorded-0001',
      pollAfterMs: 5000,
    })
  })

  it('提交缺少任务 ID 抛 unknown', async () => {
    await expect(submitVideo({}, taskOptions([{ ok: true }]))).rejects.toMatchObject({
      code: 'unknown',
    })
  })

  it('轮询 running → pending', async () => {
    const recorded = fixture<RecordedCall>('video-poll-pending')
    const result = await pollVideo(
      'cgt-2026-recorded-0001',
      taskOptions([jsonResponse(recorded.response.body, recorded.response.status)]),
    )
    expect(result).toEqual({ state: 'pending', pollAfterMs: 5000, remote: 'running' })
  })

  it('轮询 succeeded → 视频 + 尾帧 + 用量', async () => {
    const recorded = fixture<RecordedCall>('video-poll-succeeded')
    const result = await pollVideo(
      'cgt-2026-recorded-0001',
      taskOptions([jsonResponse(recorded.response.body, recorded.response.status)]),
    )
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toMatchObject({ type: 'file', kind: 'video', mime: 'video/mp4' })
    expect(result.usage).toMatchObject({ seconds: 5, outputTokens: 120 })
  })

  it('轮询 failed → failed，queued → pending，未知状态抛错', async () => {
    const failed = fixture<RecordedCall>('video-poll-failed')
    expect(
      await pollVideo(
        'cgt-2026-recorded-0001',
        taskOptions([jsonResponse(failed.response.body, failed.response.status)]),
      ),
    ).toMatchObject({ state: 'failed' })
    expect(parseTaskStatus({ status: 'queued' })).toEqual({
      state: 'pending',
      pollAfterMs: 5000,
      remote: 'queued',
    })
    expect(() => parseTaskStatus({ status: 'weird' })).toThrow(ProviderError)
  })

  it('取消排队任务会发 DELETE；运行中拒绝取消', async () => {
    const { ctx: context, fetch } = fakeContext([{ status: 'queued' }, { status: 'cancelled' }])
    const opts: TaskOptions = {
      ctx: context,
      plane: 'api',
      base: 'https://ark.cn-beijing.volces.com/api/v3',
      key: 'sk-k',
      label: '火山方舟',
      messages,
    }
    await cancelVideo('cgt-1', opts)
    expect(fetch).toHaveBeenCalledTimes(2)
    const init = (fetch.mock.calls[1]?.[1] ?? {}) as RequestInit
    expect(init.method).toBe('DELETE')

    await expect(cancelVideo('cgt-1', taskOptions([{ status: 'running' }]))).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('openAiModelList：模型列表解析', () => {
  it('归一化条目并过滤空 id', () => {
    const recorded = fixture<RecordedCall>('model-list')
    expect(openAiModelList(recorded.response.body)).toEqual([
      {
        id: 'doubao-seed-2-1-pro-260628',
        ownedBy: 'volcengine',
        created: 1760000000,
      },
      { id: 'doubao-seedream-5-0-pro-260628' },
    ])
  })

  it('缺少 data 数组时抛 unknown', () => {
    expect(() => openAiModelList({})).toThrow(ProviderError)
  })
})
