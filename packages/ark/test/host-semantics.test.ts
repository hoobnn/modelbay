/**
 * 宿主语义下的方舟行为：图片像素区间 / 视频校验 / 64 MiB 请求体 / 产物域名白名单 /
 * 失败任务的错误分类 / 抠图 / 自定义图片与视频槽 / 参考视频上传 / 套餐 ASR 与目录。
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { AdapterContext, AdapterRequest, LoadedFile } from '@modelbay/core'
import {
  arkAdapter,
  arkPlanAdapter,
  createArkAdapter,
  createArkPlanAdapter,
  models,
} from '../src/index'
import { nodeOptions, uploadReferenceVideo } from '../src/node/index'
import { fakeContext } from './helpers'

const IMAGE = 'ark:doubao-seedream-5-0-pro-260628'
const V25 = 'ark:doubao-seedance-2-5-260628'
const V20 = 'ark:doubao-seedance-2-0-260128'
const image = { assetId: 'source', kind: 'image' as const }
const audio = { assetId: 'voice', kind: 'audio' as const }
const video = { assetId: 'motion', kind: 'video' as const }

/** 带元数据的 files 读取（宿主提供）。 */
function setup(
  replies: unknown[] = [],
  over: Partial<LoadedFile> = {},
  secret?: Record<string, string>,
) {
  const f = fakeContext(replies, { secret: secret ?? { ARK_API_KEY: 'test-secret' } })
  f.ctx.files = {
    read: vi.fn(async (ref) => ({
      data: new Uint8Array([1, 2, 3]),
      mime: ref.kind === 'audio' ? 'audio/wav' : ref.kind === 'video' ? 'video/mp4' : 'image/png',
      width: 1024,
      height: 1024,
      duration: 4,
      videoCodec: 'h264',
      frameRate: 30,
      audioCodecs: [],
      ...over,
    })),
  }
  f.ctx.settings = {}
  return f
}
const gen = (capability: AdapterRequest['capability'], model: string, input: unknown) =>
  ({ capability, model, input }) as AdapterRequest

describe('图片：像素区间与比例', () => {
  it.each([
    [{ width: 1024, height: 768 }],
    [{ width: 4000, height: 4000 }],
    [{ width: 4096, height: 128 }],
    [{ extra: { size: '3K' } }],
  ])('越界尺寸在 HTTP 之前拒绝 %j', async (extraInput) => {
    const f = setup()
    await expect(
      arkAdapter.submit(gen('image.generate', IMAGE, { prompt: 'cat', ...extraInput }), f.ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('区间内的自定义宽高原样发送', async () => {
    const f = setup([{ data: [{ b64_json: 'AQID' }] }])
    await arkAdapter.submit(
      gen('image.generate', IMAGE, { prompt: 'cat', width: 1280, height: 1024 }),
      f.ctx,
    )
    expect(f.body().size).toBe('1280x1024')
  })

  it('Seedream 5.0 拒绝 seed', async () => {
    const f = setup()
    await expect(
      arkAdapter.submit(gen('image.generate', IMAGE, { prompt: 'cat', seed: 1 }), f.ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('逐项错误按平台规则归类，图片 mime 取请求的 output_format', async () => {
    const f = setup([
      { data: [{ error: { code: 'InsufficientBalance', message: 'test-secret' } }] },
    ])
    await expect(
      arkAdapter.submit(gen('image.generate', IMAGE, { prompt: 'cat' }), f.ctx),
    ).rejects.toMatchObject({ code: 'quota', message: '[redacted]', retryable: false })
    const g = setup([{ data: [{ b64_json: 'AQID' }] }])
    const out = await arkAdapter.submit(
      gen('image.generate', IMAGE, { prompt: 'cat', extra: { output_format: 'png' } }),
      g.ctx,
    )
    expect(out).toMatchObject({ outputs: [{ mime: 'image/png' }] })
  })

  it('产物 URL 必须是白名单域名', async () => {
    for (const url of [
      'https://evil.example.com/a.png',
      'http://x.volces.com/a.png',
      'https://volces.com/a.png',
    ]) {
      const f = setup([{ data: [{ url }] }])
      await expect(
        arkAdapter.submit(gen('image.generate', IMAGE, { prompt: 'cat' }), f.ctx),
      ).rejects.toMatchObject({ code: 'unknown' })
    }
    const ok = setup([{ data: [{ url: 'https://x.tos-cn-beijing.volces.com/a.png' }] }])
    await expect(
      arkAdapter.submit(gen('image.generate', IMAGE, { prompt: 'cat' }), ok.ctx),
    ).resolves.toMatchObject({ state: 'succeeded' })
  })
})

describe('自定义图片 / 视频槽', () => {
  it('custom-image / custom-video 换成设置里的 Endpoint ID，未填写不发请求', async () => {
    const f = setup([{ data: [{ b64_json: 'AQID' }] }, { id: 't1' }])
    f.ctx.settings = { customImageModel: 'ep-img', customVideoModel: 'ep-vid' }
    await arkAdapter.submit(gen('image.generate', 'ark:custom-image', { prompt: 'cat' }), f.ctx)
    expect(f.body(0).model).toBe('ep-img')
    await arkAdapter.submit(gen('video.generate', 'ark:custom-video', { prompt: 'sea' }), f.ctx)
    expect(f.body(1).model).toBe('ep-vid')
    const empty = setup()
    await expect(
      arkAdapter.submit(gen('video.generate', 'ark:custom-video', { prompt: 'sea' }), empty.ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(empty.fetch).not.toHaveBeenCalled()
  })
})

describe('视频校验', () => {
  it.each([
    [{ prompt: 'cat', duration: 1 }],
    [{ prompt: 'cat', duration: 31 }],
    [{ prompt: 'cat', seed: 1 }],
    [{ prompt: 'cat', resolution: '4k' }],
    [{ prompt: 'cat', aspectRatio: '2:1' }],
    [{ prompt: 'cat', extra: { omni_reference_task_type: 'edit' } }],
    [{ prompt: 'cat', extra: { draft: true }, resolution: '720p' }],
    [{ prompt: 'cat', extra: { content: [] } }],
    [{ prompt: 'cat', firstFrame: image, references: [image] }],
  ])('无效参数在计费请求前失败 %j', async (input) => {
    const f = setup()
    await expect(arkAdapter.submit(gen('video.generate', V25, input), f.ctx)).rejects.toMatchObject(
      {
        code: 'invalid_input',
      },
    )
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('Seedance 2.0 不支持 omni 任务类型 / 草稿，时长上限 15', async () => {
    for (const input of [
      { prompt: 'p', references: [image], extra: { omni_reference_task_type: 'reference' } },
      { prompt: 'p', extra: { draft: true }, resolution: '480p' },
      { prompt: 'p', duration: 16 },
    ]) {
      const f = setup()
      await expect(
        arkAdapter.submit(gen('video.generate', V20, input), f.ctx),
      ).rejects.toMatchObject({
        code: 'invalid_input',
      })
      expect(f.fetch).not.toHaveBeenCalled()
    }
  })

  it('2.5 的 480p 草稿通过；套餐不支持草稿', async () => {
    const f = setup([{ id: 'd1' }])
    await arkAdapter.submit(
      gen('video.generate', V25, { prompt: 'p', extra: { draft: true }, resolution: '480p' }),
      f.ctx,
    )
    expect(f.body().draft).toBe(true)
    const p = setup([], {}, { ARK_AGENT_PLAN_API_KEY: 'k' })
    await expect(
      arkPlanAdapter.submit(
        gen('video.generate', 'ark-plan:doubao-seedance-2.5', {
          prompt: 'p',
          extra: { draft: true },
          resolution: '480p',
        }),
        p.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('generate_audio 与 return_last_frame 等白名单字段到达请求体', async () => {
    const f = setup([{ id: 'a' }])
    await arkAdapter.submit(
      gen('video.generate', V25, {
        prompt: 'p',
        audio: false,
        extra: {
          watermark: true,
          return_last_frame: true,
          service_tier: 'flex',
          output_format: 'mov',
        },
      }),
      f.ctx,
    )
    expect(f.body()).toMatchObject({
      generate_audio: false,
      watermark: true,
      return_last_frame: true,
      service_tier: 'flex',
      output_format: 'mov',
    })
  })

  it('首尾帧编码后超过 64 MiB 在 HTTP 前拒绝', async () => {
    const f = setup([], { data: new Uint8Array(25 * 1024 * 1024) })
    await expect(
      arkAdapter.submit(
        gen('video.generate', V25, { prompt: 'p', firstFrame: image, lastFrame: image }),
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('本地视频缺少上传实现 / 越界引用 / 累计超长都不发送生成请求', async () => {
    for (const [model, input, over] of [
      [V25, { prompt: '@video2', references: [video] }, {}],
      [V25, { prompt: 'p', references: [video, video] }, { duration: 16 }],
    ] as const) {
      const f = setup([], over)
      await expect(
        createArkAdapter(models, { uploadVideo: async () => 'https://x.volces.com/v.mp4' }).submit(
          gen('video.generate', model, input),
          f.ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(f.fetch).not.toHaveBeenCalled()
    }
    for (const model of [V25, V20]) {
      const none = setup()
      await expect(
        arkAdapter.submit(
          gen('video.generate', model, { prompt: '运动', references: [video] }),
          none.ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(none.fetch).not.toHaveBeenCalled()
    }
  })

  it('三类素材上传并按引用编号改写；edit / extend 自动对齐画幅与时长', async () => {
    const upload = vi.fn(async () => 'https://b.tos-cn-beijing.volces.com/v.mp4')
    const adapter = createArkAdapter(models, { uploadVideo: upload })
    const f = setup([{ id: 'ok' }, { id: 'e' }])
    await adapter.submit(
      gen('video.generate', V25, {
        prompt: '@图片1 参考 @video1 和 @audio1',
        references: [image, video, audio],
      }),
      f.ctx,
    )
    const body = f.body() as { content: Array<Record<string, unknown>> }
    expect(body.content.map((c) => c.role)).toEqual([
      undefined,
      'reference_image',
      'reference_video',
      'reference_audio',
    ])
    expect(body.content[0]!.text).toBe('@image1 参考 @video1 和 @audio1')
    expect((body.content[2]!.video_url as { url: string }).url).toBe(
      'https://b.tos-cn-beijing.volces.com/v.mp4',
    )
    expect(upload).toHaveBeenCalledOnce()
    await adapter.submit(
      gen('video.generate', V25, {
        prompt: '替换 @video1 的背景',
        references: [video],
        aspectRatio: '16:9',
        duration: 5,
        extra: { omni_reference_task_type: 'edit' },
      }),
      f.ctx,
    )
    expect(f.body(1)).toMatchObject({
      ratio: 'adaptive',
      duration: -1,
      omni_reference_task_type: 'edit',
    })
  })

  it('编辑任务的参考视频至少 4 秒', async () => {
    const f = setup([], { duration: 3 })
    await expect(
      createArkAdapter(models, { uploadVideo: async () => 'https://x.volces.com/v.mp4' }).submit(
        gen('video.generate', V25, {
          prompt: '编辑',
          references: [video],
          extra: { omni_reference_task_type: 'edit' },
        }),
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('经 nodeOptions 注入 TOS 上传：读 settings，对象 key 前缀可配', async () => {
    const f = setup(
      [new Response(null, { status: 200 }), { id: 'accepted' }],
      {},
      {
        ARK_API_KEY: 'test-secret',
        ARK_TOS_ACCESS_KEY: 'ak',
        ARK_TOS_SECRET_KEY: 'sk',
      },
    )
    f.ctx.settings = {
      referenceBucket: 'test-bucket',
      referenceKeyPrefix: 'host/video-references',
    }
    await createArkAdapter(models, nodeOptions).submit(
      gen('video.generate', V25, { prompt: 'p', references: [video] }),
      f.ctx,
    )
    const put = new URL(String(f.fetch.mock.calls[0]![0]))
    expect(put.hostname).toBe('test-bucket.tos-cn-beijing.volces.com')
    expect(put.pathname).toMatch(/^\/host\/video-references\/[a-f0-9]{64}\.mp4$/)
    const direct = await uploadReferenceVideo(
      { ...f.ctx, settings: { referenceBucket: 'test-bucket' } } as AdapterContext,
      { data: new Uint8Array([1]), mime: 'video/mp4' },
    ).catch((e) => e)
    expect(direct).toBeDefined()
  })
})

describe('轮询', () => {
  it('failed 任务按平台错误分类，且不泄露密钥', async () => {
    const f = setup([
      { status: 'failed', error: { code: 'ContentPolicyViolation', message: 'content policy' } },
      { status: 'failed', error: { code: 'InsufficientBalance', message: 'test-secret' } },
      { status: 'expired' },
      { status: 'weird' },
    ])
    expect(await arkAdapter.poll!('id', f.ctx)).toMatchObject({
      error: { code: 'content_policy', retryable: false },
    })
    expect(await arkAdapter.poll!('id', f.ctx)).toMatchObject({
      error: { code: 'quota', message: '[redacted]' },
    })
    expect(await arkAdapter.poll!('id', f.ctx)).toMatchObject({
      state: 'failed',
      error: { code: 'timeout' },
    })
    await expect(arkAdapter.poll!('id', f.ctx)).rejects.toMatchObject({ code: 'unknown' })
  })

  it('权限外的产物 URL 被拒绝', async () => {
    const f = setup([
      { status: 'succeeded', content: { video_url: 'http://127.0.0.1/private.mp4' } },
    ])
    await expect(arkAdapter.poll!('id', f.ctx)).rejects.toMatchObject({ code: 'unknown' })
  })

  it('POST 网关错误保留 unknown 且不可重试', async () => {
    for (const status of [408, 500, 502, 503, 504]) {
      const f = setup([new Response('<html>gateway</html>', { status })])
      await expect(
        arkAdapter.submit(gen('video.generate', V25, { prompt: 'p' }), f.ctx),
      ).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    }
  })
})

describe('抠图', () => {
  it('只把 z_index > 0 的图层输出为候选，底图留在元数据；域名白名单同样适用', async () => {
    const f = setup([
      {
        data: [
          { z_index: 0, b64_json: 'AQID' },
          {
            z_index: 1,
            b64_json: 'BAUG',
            name: '人物',
            bounding_box: { absolute: [0, 0, 32, 64] },
          },
          { z_index: 2, url: 'https://result.tos-cn-beijing.volces.com/logo.png', name: '文字' },
        ],
      },
    ])
    const out = await arkAdapter.submit(
      gen('image.process', IMAGE, { image, operation: 'cutout', prompt: '拆出人物' }),
      f.ctx,
    )
    expect(f.body()).toMatchObject({
      image: 'data:image/png;base64,AQID',
      layer_decomposition: true,
      prompt: '拆出人物',
    })
    expect(out).toMatchObject({
      outputs: [{ name: '人物.png' }, { url: expect.any(String) }, { type: 'json' }],
    })
    const bad = setup([{ data: [{ z_index: 1, url: 'https://evil.example.com/x.png' }] }])
    await expect(
      arkAdapter.submit(gen('image.process', IMAGE, { image, operation: 'cutout' }), bad.ctx),
    ).rejects.toMatchObject({ code: 'unknown' })
  })

  it.each([
    [{ mime: 'image/webp' }],
    [{ width: 200, height: 200 }],
    [{ width: NaN }],
    [{ data: new Uint8Array() }],
  ])('抠图原图约束在 HTTP 之前验证 %j', async (over) => {
    const f = setup([], over)
    await expect(
      arkAdapter.submit(gen('image.process', IMAGE, { image, operation: 'cutout' }), f.ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it.each([
    [{ data: [{ z_index: 1, b64_json: 'not base64 !' }] }],
    [{ data: [{ z_index: 1, b64_json: 'AQID', bounding_box: { absolute: [0, 1, 'bad', 3] } }] }],
    [
      {
        data: [
          { z_index: 1, b64_json: 'AQID' },
          { z_index: 1, b64_json: 'AQID' },
        ],
      },
    ],
    [{}],
  ])('无效图层保持 unknown %j', async (reply) => {
    const f = setup([reply])
    await expect(
      arkAdapter.submit(gen('image.process', IMAGE, { image, operation: 'cutout' }), f.ctx),
    ).rejects.toMatchObject({ code: 'unknown' })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('套餐 ASR 与目录接线', () => {
  const planSecret = { ARK_AGENT_PLAN_API_KEY: 'plan-secret' }
  function reply(value: unknown, final = false) {
    const payload = gzipSync(Buffer.from(JSON.stringify(value)))
    const header = Buffer.from([0x11, final ? 0x93 : 0x91, 0x11, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    header.writeInt32BE(final ? -2 : 1, 4)
    header.writeUInt32BE(payload.length, 8)
    return Buffer.concat([header, payload])
  }
  const asr = gen('audio.transcribe', 'ark-plan:doubao-seed-asr-2.0', { audio })

  it('走 ctx.socket：初始化确认后发送音频，末包负序号，分句毫秒转秒', async () => {
    const f = setup([], { mime: 'audio/mpeg' }, planSecret)
    const send = vi.fn()
    const close = vi.fn()
    const receive = vi
      .fn()
      .mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(
        reply(
          {
            result: {
              text: '你好',
              utterances: [{ text: '你好', start_time: 100, end_time: 900 }],
            },
          },
          true,
        ),
      )
    f.ctx.socket = vi.fn(async () => ({ send, receive, close }))
    const result = await createArkPlanAdapter(models, nodeOptions).submit(asr, f.ctx)
    expect(f.ctx.socket).toHaveBeenCalledWith(
      'wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream',
      expect.objectContaining({
        'X-Api-Key': 'plan-secret',
        'X-Api-Resource-Id': 'volc.seedasr.sauc.duration',
      }),
    )
    const first = Buffer.from(send.mock.calls[0]![0] as Uint8Array)
    expect(JSON.parse(gunzipSync(first.subarray(12)).toString())).toMatchObject({
      audio: { format: 'mp3' },
    })
    const last = Buffer.from(send.mock.calls[1]![0] as Uint8Array)
    expect(last[1]).toBe(0x23)
    expect(last.readInt32BE(4)).toBe(-2)
    expect(result).toMatchObject({
      outputs: [
        { type: 'text', text: '你好' },
        { type: 'json', value: { segments: [{ text: '你好', start: 0.1, end: 0.9 }] } },
      ],
    })
    expect(close).toHaveBeenCalled()
  })

  it('断流不当作成功：关闭连接、结果未知、不重试', async () => {
    const f = setup([], { mime: 'audio/wav' }, planSecret)
    const close = vi.fn()
    f.ctx.socket = vi.fn(async () => ({
      send: vi.fn(),
      close,
      receive: vi.fn().mockResolvedValueOnce(reply({})).mockRejectedValueOnce(new Error('closed')),
    }))
    await expect(
      createArkPlanAdapter(models, nodeOptions).submit(asr, f.ctx),
    ).rejects.toMatchObject({
      code: 'unavailable',
      outcome: 'unknown',
      retryable: false,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('缺少 socket 的宿主明确报错；没注入 Node 实现时 unavailable', async () => {
    const f = setup([], {}, planSecret)
    await expect(createArkPlanAdapter(models, nodeOptions).submit(asr, f.ctx)).rejects.toThrow(
      '不支持',
    )
    await expect(arkPlanAdapter.submit(asr, f.ctx)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('套餐 TTS 拒绝复刻音色', async () => {
    const f = setup([], {}, planSecret)
    await expect(
      arkPlanAdapter.submit(
        gen('audio.speech', 'ark-plan:doubao-seed-tts-2.0', { text: 'hi', voice: 'S_123456' }),
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('目录 native 经注入的 AK/SK 实现：套餐 ID 换回按量 ID，过滤嵌入 / 识别，文本标 agentOnly', async () => {
    const f = setup(
      [
        {
          Result: {
            Datas: [
              { ModelID: 'new-chat' },
              { ModelID: 'new-chat' },
              { ModelID: 'doubao-seedance-2.5' },
              { ModelID: 'doubao-embedding-vision' },
            ],
          },
        },
      ],
      {},
      { ...planSecret, ARK_PLAN_ACCESS_KEY: 'access', ARK_PLAN_SECRET_KEY: 'secret' },
    )
    const list = await createArkPlanAdapter(models, nodeOptions).native!('listModels', {}, f.ctx)
    expect(list).toEqual([
      { id: 'new-chat', kind: 'llm', agentOnly: true, features: ['tools', 'structured'] },
      { id: 'doubao-seedance-2-5-260628' },
    ])
    expect(JSON.stringify(f.fetch.mock.calls)).not.toContain('plan-secret')
    await expect(arkPlanAdapter.native!('listModels', {}, f.ctx)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
})

describe('套餐 TTS 与新版 doubao-speech 配合', () => {
  it('读 ctx.settings 的音色 / 格式，鉴权用套餐 Key', async () => {
    const stream = '{"code":0,"data":"AQID"}\n{"code":20000000}'
    const f = setup([new Response(stream)], {}, { ARK_AGENT_PLAN_API_KEY: 'plan-secret' })
    f.ctx.settings = { voice: 'zh_male_test', format: 'mp3', sampleRate: '24000' }
    await arkPlanAdapter.submit(
      gen('audio.speech', 'ark-plan:doubao-seed-tts-2.0', { text: '你好' }),
      f.ctx,
    )
    const [url, init] = f.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional')
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'plan-secret' })
    expect(JSON.parse(String(init.body)).req_params.speaker).toBe('zh_male_test')
  })
})
