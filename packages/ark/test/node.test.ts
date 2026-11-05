import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vite-plus/test'
import {
  asrFrame,
  asrPacket,
  listPlanModels,
  objectKey,
  planAsrHeaders,
  planAsrPayload,
  planAsrSegments,
  planDirectoryHeaders,
  presignS3,
  referenceStorageHost,
  s3Target,
  tosUploader,
  transcribePlan,
} from '../src/node/index'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

const storage = {
  referenceStorage: 's3' as const,
  referenceEndpoint: 'https://s3.example.com',
  referencePathStyle: false,
  referenceBucket: 'my-bucket',
  referenceRegion: 'us-east-1',
}

describe('S3 兼容存储：s3Target / referenceStorageHost', () => {
  it('路径式与虚拟主机式', () => {
    expect(s3Target(storage)).toEqual({ host: 'my-bucket.s3.example.com', prefix: '' })
    expect(s3Target({ ...storage, referencePathStyle: true })).toEqual({
      host: 's3.example.com',
      prefix: '/my-bucket',
    })
    expect(referenceStorageHost(storage)).toBe('my-bucket.s3.example.com')
  })

  it('OSS / COS 按地域拼地址', () => {
    expect(
      s3Target({
        ...storage,
        referenceStorage: 'oss',
        referenceRegion: 'cn-hangzhou',
        referenceEndpoint: '',
      }),
    ).toEqual({ host: 'my-bucket.s3.oss-cn-hangzhou.aliyuncs.com', prefix: '' })
  })

  it('非法地址 / 桶名 / 协议返回 undefined', () => {
    expect(s3Target({ ...storage, referenceEndpoint: 'not-a-url' })).toBeUndefined()
    expect(s3Target({ ...storage, referenceEndpoint: 'http://s3.example.com' })).toBeUndefined()
    expect(s3Target({ ...storage, referenceBucket: 'BAD' })).toBeUndefined()
    expect(referenceStorageHost({ ...storage, referenceStorage: 'tos' })).toBeUndefined()
  })
})

describe('presignS3 / objectKey', () => {
  it('用固定时间生成可复现的 SigV4 预签名 URL', () => {
    const url = presignS3({
      method: 'PUT',
      host: 'my-bucket.s3.example.com',
      path: '/modelbay/video-references/a.mp4',
      region: 'us-east-1',
      accessKeyId: '<redacted>',
      secretAccessKey: '<redacted>',
      expires: 900,
      now: new Date('2026-11-04T00:00:00.000Z'),
    })
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-Date=20261104T000000Z')
    expect(url).toContain('X-Amz-SignedHeaders=host')
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/)
  })

  it('objectKey 由字节与 MIME 决定', () => {
    expect(objectKey(new Uint8Array([1, 2, 3]), 'video/mp4')).toMatch(
      /^modelbay\/video-references\/[0-9a-f]{64}\.mp4$/,
    )
    expect(objectKey(new Uint8Array([1]), 'video/quicktime')).toMatch(/\.mov$/)
  })
})

describe('planDirectoryHeaders / listPlanModels', () => {
  const now = new Date('2026-11-04T00:00:00.000Z')

  it('签名头包含 HMAC-SHA256、X-Date 与 payload hash', () => {
    const signature = planDirectoryHeaders('<redacted>', '<redacted>', now)
    expect(signature.headers.Authorization).toContain('HMAC-SHA256 Credential=<redacted>/')
    expect(signature.headers.Authorization).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(signature.headers['X-Date']).toBe('20261104T000000Z')
    expect(signature.body).toBe('{"Edition":"personal"}')
  })

  it('套餐目录返回去重后的模型 ID', async () => {
    const recorded = fixture<RecordedCall>('plan-directory')
    const { ctx } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { ARK_PLAN_ACCESS_KEY: 'ak', ARK_PLAN_SECRET_KEY: 'sk' },
    })
    expect(await listPlanModels(ctx, now)).toEqual([
      { id: 'doubao-seed-2.1-pro' },
      { id: 'doubao-seedream-5.0-pro' },
    ])
  })

  it('缺 AK/SK 抛 auth', async () => {
    const { ctx } = fakeContext([], { secret: {} })
    await expect(listPlanModels(ctx, now)).rejects.toMatchObject({ code: 'auth' })
  })

  it('上游 5xx 抛 unavailable，缺少 Datas 抛 unknown', async () => {
    const failed = fakeContext(
      [jsonResponse({ ResponseMetadata: { Error: { Code: 'x' } } }, 500)],
      {
        secret: { ARK_PLAN_ACCESS_KEY: 'ak', ARK_PLAN_SECRET_KEY: 'sk' },
      },
    )
    await expect(listPlanModels(failed.ctx, now)).rejects.toMatchObject({ code: 'unavailable' })
    const bad = fakeContext([{ Result: {} }], {
      secret: { ARK_PLAN_ACCESS_KEY: 'ak', ARK_PLAN_SECRET_KEY: 'sk' },
    })
    await expect(listPlanModels(bad.ctx, now)).rejects.toMatchObject({ code: 'unknown' })
  })
})

/** 服务端响应帧（full server response）。 */
function serverFrame(payload: unknown, flags = 1): Buffer {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload)))
  const header = Buffer.alloc(12)
  header[0] = 0x11
  header[1] = (9 << 4) | flags
  header[2] = 0x11
  header.writeInt32BE(1, 4)
  header.writeUInt32BE(compressed.length, 8)
  return Buffer.concat([header, compressed])
}

describe('ASR 帧编解码', () => {
  it('asrFrame 产出 12 字节头 + gzip 负载', () => {
    const frame = asrFrame(1, 1, Buffer.from('hello'))
    expect(frame.length).toBeGreaterThan(12)
    expect(frame[0]).toBe(0x11)
    expect(frame[1]).toBe(0x11)
    expect(frame.readUInt32BE(8)).toBe(frame.length - 12)
  })

  it('asrPacket 解码服务端帧', () => {
    expect(asrPacket(serverFrame({ result: { text: '你好' } }))).toEqual({
      final: false,
      data: { result: { text: '你好' } },
    })
    expect(asrPacket(serverFrame({}, 3)).final).toBe(true)
  })

  it('错误帧与不完整帧', () => {
    const errorFrame = Buffer.alloc(12)
    errorFrame[0] = 0x11
    errorFrame[1] = (15 << 4) | 1
    errorFrame.writeUInt32BE(45000001, 4)
    expect(() => asrPacket(errorFrame)).toThrow(/语音识别错误/)
    expect(() => asrPacket(Buffer.alloc(3))).toThrow()
    expect(() => asrPacket(Buffer.alloc(12))).toThrow()
  })
})

describe('方舟套餐流式语音识别', () => {
  const pcm = (ms: number, rate = 16000) => new Uint8Array(rate * 2 * (ms / 1000))

  it('planAsrHeaders 带齐官方要求的请求头', () => {
    const headers = planAsrHeaders('plan-key', { requestId: 'req-1' })
    expect(headers['X-Api-Key']).toBe('plan-key')
    expect(headers['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')
    expect(headers['X-Api-Request-Id']).toBe('req-1')
    expect(headers['X-Api-Connect-Id']).toBe('req-1')
  })

  it('planAsrPayload 按官方协议给出 user/audio/request 三段', () => {
    const payload = planAsrPayload({ audio: pcm(200), rate: 16000, language: 'zh-CN' })
    expect(payload).toMatchObject({
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1, language: 'zh-CN' },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        show_utterances: true,
      },
    })
    expect(() => planAsrPayload({ audio: pcm(200), bits: 8 })).toThrow(/16-bit/)
    expect(() => planAsrPayload({ audio: pcm(200), channel: 3 })).toThrow(/声道/)
  })

  it('planAsrSegments 按 200ms 切片并拒绝未对齐的音频', () => {
    const audio = pcm(600)
    const segments = planAsrSegments(audio, { audio, rate: 16000 })
    expect(segments).toHaveLength(3)
    expect(segments[0]?.length).toBe(16000 * 2 * 0.2)
    expect(() => planAsrSegments(new Uint8Array(3), { audio: new Uint8Array(3) })).toThrow(/对齐/)
    expect(() => planAsrSegments(new Uint8Array(0), { audio: new Uint8Array(0) })).toThrow(/为空/)
  })

  it('transcribePlan 发完整请求与音频片，并返回识别文本', async () => {
    const { ctx } = fakeContext([], { secret: { ARK_AGENT_PLAN_API_KEY: 'plan-key' } })
    const sent: Uint8Array[] = []
    let url = ''
    let headers: Record<string, string> = {}
    const socket = async (u: string, h: Record<string, string>) => {
      url = u
      headers = h
      return {
        send: (data: Uint8Array) => sent.push(data),
        receive: async () => serverFrame({ result: { text: '你好世界' } }, 3),
        close: () => undefined,
      }
    }
    const audio = pcm(400)
    const result = await transcribePlan(ctx, { audio }, socket)
    expect(url).toBe('wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream')
    expect(headers['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')
    // 完整客户端请求 + 两片音频
    expect(sent).toHaveLength(3)
    expect(sent[0]?.[0]).toBe(0x11)
    expect(sent[1]?.[1]).toBe(0x21)
    // 最后一片用负序号表示结束
    expect(sent[2]?.[1]).toBe(0x23)
    expect(result.state).toBe('succeeded')
    expect(result.state === 'succeeded' && result.outputs).toEqual([
      { type: 'text', text: '你好世界' },
    ])
  })

  it('缺少凭证与识别失败都给出明确错误', async () => {
    const { ctx } = fakeContext([], {
      secret: { ARK_AGENT_PLAN_API_KEY: undefined, ARK_API_KEY: undefined },
    })
    await expect(transcribePlan(ctx, { audio: pcm(200) })).rejects.toMatchObject({
      code: 'auth',
    })
    const { ctx: keyed } = fakeContext([], { secret: { ARK_AGENT_PLAN_API_KEY: 'k' } })
    const empty = async () => new Uint8Array()
    await expect(
      transcribePlan(keyed, { audio: pcm(200) }, async () => ({
        send: () => undefined,
        receive: empty,
        close: () => undefined,
      })),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})

describe('Node 子路径的 TODO 能力', () => {
  it('tosUploader 给出清晰错误', () => {
    const { ctx } = fakeContext()
    expect(() => tosUploader(ctx, 'bucket', 'cn-beijing')).toThrow(/TODO/)
  })
})
