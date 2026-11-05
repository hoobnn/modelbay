import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  GET_EXPIRES,
  objectKey,
  PUT_EXPIRES,
  referenceStorageHost,
  referenceUploader,
  s3Uploader,
  tosUploader,
  type ReferenceStorage,
} from '../src/node/index'
import { fakeContext } from './helpers'

const file = { data: new Uint8Array([1, 2, 3]), mime: 'video/mp4' }

const tosStorage: ReferenceStorage = {
  referenceStorage: 'tos',
  referenceEndpoint: '',
  referencePathStyle: false,
  referenceBucket: 'my-bucket',
  referenceRegion: 'cn-beijing',
}

const s3Storage: ReferenceStorage = {
  referenceStorage: 's3',
  referenceEndpoint: 'https://s3.example.com',
  referencePathStyle: false,
  referenceBucket: 'my-bucket',
  referenceRegion: 'us-east-1',
}

/** 带存储密钥的假上下文。 */
function storageContext(replies: unknown[] = []) {
  return fakeContext(replies, {
    secret: { ARK_TOS_ACCESS_KEY: 'test-ak', ARK_TOS_SECRET_KEY: 'test-sk' },
  })
}

describe('TOS 参考视频上传', () => {
  it('官方 SDK 签名，宿主 PUT 原件，返回限时 GET 地址', async () => {
    const { ctx, fetch } = storageContext([new Response(null, { status: 200 })])
    const url = new URL(await tosUploader(ctx, 'my-bucket', 'cn-beijing')(file))
    const [put, init] = fetch.mock.calls[0] as [string, RequestInit]
    const upload = new URL(put)
    expect(upload.hostname).toBe('my-bucket.tos-cn-beijing.volces.com')
    expect(upload.pathname).toMatch(/^\/modelbay\/video-references\/[0-9a-f]{64}\.mp4$/)
    expect(upload.searchParams.get('X-Tos-Expires')).toBe(String(PUT_EXPIRES))
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: file.data,
    })
    expect(url.pathname).toBe(upload.pathname)
    expect(url.searchParams.get('X-Tos-Expires')).toBe(String(GET_EXPIRES))
    expect(url.searchParams.get('X-Tos-Signature')).not.toBe(
      upload.searchParams.get('X-Tos-Signature'),
    )
    // 签名 URL 与密钥都不进日志
    expect(ctx.log).not.toHaveBeenCalled()
  })

  it('桶名或地域格式不对时不发请求', async () => {
    const { ctx, fetch } = storageContext()
    expect(() => tosUploader(ctx, 'BAD_BUCKET', 'cn-beijing')).toThrow(/桶名/)
    expect(() => tosUploader(ctx, 'my-bucket', 'evil.com/x')).toThrow(/地域/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('缺存储密钥时给出明确错误，不发请求', async () => {
    const { ctx, fetch } = fakeContext([], { secret: {} })
    expect(() => tosUploader(ctx, 'my-bucket', 'cn-beijing')).toThrow(/Access Key/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('上传失败不泄露签名和密钥，也不标成生成提交未知', async () => {
    const cases = [
      { reply: new Response('secret body', { status: 403 }), code: 'auth' },
      { reply: new Error('signed-url-secret'), code: 'unavailable' },
    ] as const
    for (const { reply, code } of cases) {
      const { ctx, fetch } = storageContext([reply])
      const error = await tosUploader(ctx, 'my-bucket', 'cn-beijing')(file).catch((e) => e)
      expect(error).toMatchObject({ code, cause: undefined, outcome: undefined })
      expect(String(error)).toContain('尚未提交视频生成')
      expect(String(error)).not.toMatch(/secret|test-sk|X-Tos/)
      expect(fetch).toHaveBeenCalledOnce()
    }
  })
})

describe('S3 兼容存储上传', () => {
  it('PUT 声明不签负载，返回七天 GET 链接', async () => {
    const { ctx, fetch } = storageContext([new Response(null, { status: 200 })])
    const url = new URL(await s3Uploader(ctx, s3Storage, 'us-east-1')(file))
    const [put, init] = fetch.mock.calls[0] as [string, RequestInit]
    const upload = new URL(put)
    expect(upload.hostname).toBe('my-bucket.s3.example.com')
    expect(upload.pathname).toMatch(/^\/modelbay\/video-references\/[0-9a-f]{64}\.mp4$/)
    expect(upload.searchParams.get('X-Amz-Expires')).toBe(String(PUT_EXPIRES))
    expect(upload.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/s3/aws4_request')
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
      body: file.data,
    })
    expect(url.pathname).toBe(upload.pathname)
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(GET_EXPIRES))
    expect(put).not.toMatch(/test-sk/)
  })

  it('路径风格：桶名在路径里', async () => {
    const { ctx, fetch } = storageContext([new Response(null, { status: 200 })])
    await s3Uploader(
      ctx,
      {
        ...s3Storage,
        referenceEndpoint: 'https://minio.example.com:9000',
        referencePathStyle: true,
      },
      'us-east-1',
    )(file)
    const upload = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(upload.host).toBe('minio.example.com:9000')
    expect(upload.pathname).toMatch(/^\/my-bucket\/modelbay\/video-references\//)
  })

  it('不安全或带路径的地址直接拒绝，不发请求', () => {
    for (const endpoint of [
      'http://minio.example.com',
      'https://minio.example.com/base',
      'not a url',
    ]) {
      const { ctx, fetch } = storageContext()
      expect(() =>
        s3Uploader(ctx, { ...s3Storage, referenceEndpoint: endpoint }, 'us-east-1'),
      ).toThrow(ProviderError)
      expect(fetch).not.toHaveBeenCalled()
    }
  })
})

describe('referenceUploader：按配置选后端', () => {
  it('tos 走官方 SDK，其余走 S3 兼容签名', async () => {
    const tos = storageContext([new Response(null, { status: 200 })])
    const tosUrl = new URL(await referenceUploader(tos.ctx, tosStorage)(file))
    expect(tosUrl.hostname).toBe('my-bucket.tos-cn-beijing.volces.com')

    const s3 = storageContext([new Response(null, { status: 200 })])
    const s3Url = new URL(await referenceUploader(s3.ctx, s3Storage)(file))
    expect(s3Url.hostname).toBe('my-bucket.s3.example.com')
  })

  it('缺桶名或地域时报错', () => {
    const { ctx } = storageContext()
    expect(() => referenceUploader(ctx, { ...tosStorage, referenceBucket: '' })).toThrow(/存储桶/)
    expect(() => referenceUploader(ctx, { ...tosStorage, referenceRegion: '' })).toThrow(/存储桶/)
  })
})

describe('objectKey 与存储放行域名', () => {
  it('对象键由内容哈希决定，mov 保留扩展名', () => {
    expect(objectKey(file.data, 'video/mp4')).toMatch(
      /^modelbay\/video-references\/[0-9a-f]{64}\.mp4$/,
    )
    expect(objectKey(file.data, 'video/quicktime')).toMatch(/\.mov$/)
  })

  it('TOS 不需要额外放行域名', () => {
    expect(referenceStorageHost({ ...tosStorage })).toBeUndefined()
  })
})
