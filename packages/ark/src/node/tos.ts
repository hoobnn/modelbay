/**
 * Node-only reference-video upload helpers, exported from `@modelbay/ark/node`.
 * Root entry never imports this file: it uses `node:crypto` / `Buffer` and the
 * TOS SDK, which are not available in browsers or Deno.
 */
import { createHash, createHmac } from 'node:crypto'
import { ProviderError, type AdapterContext } from '@modelbay/core'
import { REFERENCE_STORAGE_KEYS, type ReferenceFile } from '../reference'

export interface ReferenceStorage {
  referenceStorage: 'tos' | 'oss' | 'cos' | 's3'
  referenceEndpoint: string
  referencePathStyle: boolean
  referenceBucket: string
  referenceRegion: string
  /** 对象 key 前缀；缺省 `modelbay/video-references`（plein 宿主传 `plein/video-references`） */
  referenceKeyPrefix?: string
}

export type { ReferenceFile }

const CLOUD_ENDPOINTS: Partial<
  Record<ReferenceStorage['referenceStorage'], (region: string) => string>
> = {
  oss: (region) => `https://s3.oss-${region}.aliyuncs.com`,
  cos: (region) => `https://cos.${region}.myqcloud.com`,
}

/** S3-compatible upload target: virtual-host style puts the bucket in the host. */
export function s3Target(storage: ReferenceStorage): { host: string; prefix: string } | undefined {
  const region = storage.referenceRegion.trim()
  const cloud = CLOUD_ENDPOINTS[storage.referenceStorage]
  if (cloud && !/^[a-z]{2}(?:-[a-z0-9]+)+$/.test(region)) return undefined
  let endpoint: URL
  try {
    endpoint = new URL(cloud ? cloud(region) : storage.referenceEndpoint.trim())
  } catch {
    return undefined
  }
  const bucket = storage.referenceBucket.trim()
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
  )
    return undefined
  return storage.referencePathStyle && !cloud
    ? { host: endpoint.host, prefix: `/${bucket}` }
    : { host: `${bucket}.${endpoint.host}`, prefix: '' }
}

/** Host the host must allow for the upload itself; TOS needs no extra host. */
export function referenceStorageHost(settings: Record<string, unknown>): string | undefined {
  const storage = settings.referenceStorage
  if (storage !== 'oss' && storage !== 'cos' && storage !== 's3') return undefined
  const target = s3Target({
    referenceStorage: storage,
    referenceEndpoint: String(settings.referenceEndpoint ?? ''),
    referencePathStyle: settings.referencePathStyle === true,
    referenceBucket: String(settings.referenceBucket ?? ''),
    referenceRegion: String(settings.referenceRegion ?? ''),
  })
  return target ? new URL(`https://${target.host}`).hostname : undefined
}

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/** AWS SigV4 query-string presigning; only `host` is signed, payload is UNSIGNED-PAYLOAD. */
export function presignS3(opts: {
  method: 'PUT' | 'GET'
  host: string
  path: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expires: number
  now: Date
  query?: Record<string, string>
}): string {
  const stamp = opts.now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const day = stamp.slice(0, 8)
  const scope = `${day}/${opts.region}/s3/aws4_request`
  const query = Object.entries({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${opts.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(opts.expires),
    'X-Amz-SignedHeaders': 'host',
    ...opts.query,
  })
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .sort()
    .join('&')
  const path = opts.path.split('/').map(encode).join('/')
  const request = [
    opts.method,
    path,
    query,
    `host:${opts.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const toSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(request).digest('hex'),
  ].join('\n')
  let key: Buffer = createHmac('sha256', `AWS4${opts.secretAccessKey}`).update(day).digest()
  for (const part of [opts.region, 's3', 'aws4_request'])
    key = createHmac('sha256', key).update(part).digest()
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return `https://${opts.host}${path}?${query}&X-Amz-Signature=${signature}`
}

/** 对象 key 的默认前缀；宿主可经 `referenceKeyPrefix` 设置改掉（便于按前缀配生命周期清理）。 */
export const DEFAULT_KEY_PREFIX = 'modelbay/video-references'

/** Deterministic object key from the asset bytes. */
export function objectKey(data: Uint8Array, mime: string, prefix = DEFAULT_KEY_PREFIX): string {
  const hash = createHash('sha256').update(data).digest('hex')
  const dir = prefix.replace(/^\/+|\/+$/g, '') || DEFAULT_KEY_PREFIX
  return `${dir}/${hash}.${mime === 'video/quicktime' ? 'mov' : 'mp4'}`
}

/** 上传对象的有效期：PUT 覆盖排队窗口，GET 覆盖离线任务的排队窗口。 */
export const PUT_EXPIRES = 900
/** 覆盖离线任务的排队窗口，源桶保持私有；也是 SigV4 预签名的上限。 */
export const GET_EXPIRES = 7 * 24 * 60 * 60

/**
 * 上传参考视频，返回下游可访问的限时读取地址。
 *
 * 上传失败一律在提交生成前报错；不把带签名的 URL / 密钥带进日志、任务回执或错误 cause。
 */
export type ReferenceUpload = (file: ReferenceFile) => Promise<string>

/**
 * 用 `ctx.fetch` 把原件 PUT 上去。
 *
 * SDK 只在本地签名，所有网络请求仍走宿主的权限、取消与网络代理。
 */
async function put(
  ctx: AdapterContext,
  label: string,
  url: string,
  file: ReferenceFile,
  headers: Record<string, string> = {},
): Promise<void> {
  try {
    const response = await ctx.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mime, ...headers },
      body: new Uint8Array(file.data),
      signal: ctx.signal,
    })
    if (!response.ok)
      throw new ProviderError(
        response.status === 403 ? 'auth' : 'unavailable',
        `${label} 参考视频上传失败（HTTP ${response.status}）；尚未提交视频生成`,
      )
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError(
      ctx.signal.aborted ? 'cancelled' : 'unavailable',
      `${label} 参考视频上传未完成；尚未提交视频生成`,
    )
  }
}

/** TOS 桶名与地域的格式校验。 */
function assertTosTarget(bucket: string, region: string): void {
  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !/^[a-z]{2}-[a-z]+(?:-[a-z0-9]+)*$/.test(region)
  )
    throw new ProviderError('invalid_input', 'TOS 桶名称或地域格式不正确')
}

/**
 * 载入 TOS SDK。
 *
 * `@volcengine/tos-sdk`（MIT）是 Node 专属依赖，由集成方安装；没装时给出明确的错误。
 * 用动态 import 是为了让它保持外部依赖，不进打包产物。
 */
async function loadTosClient(): Promise<
  new (options: {
    bucket: string
    region: string
    endpoint: string
    accessKeyId: string
    accessKeySecret: string
    secure: boolean
  }) => {
    getPreSignedUrl(options: { key: string; method: 'PUT' | 'GET'; expires: number }): string
  }
> {
  let mod: typeof import('@volcengine/tos-sdk')
  try {
    mod = await import('@volcengine/tos-sdk')
  } catch (cause) {
    throw new ProviderError(
      'unavailable',
      'TOS 参考视频上传需要安装 @volcengine/tos-sdk（MIT，Node 专属依赖）',
      { cause },
    )
  }
  return mod.TosClient as never
}

/**
 * 火山引擎 TOS 上传：官方 SDK 本地签名，宿主 PUT 原件，返回限时 GET 地址。
 */
export function tosUploader(
  ctx: AdapterContext,
  bucket: string,
  region: string,
  prefix?: string,
): ReferenceUpload {
  assertTosTarget(bucket, region)
  const accessKeyId = ctx.secret('ARK_TOS_ACCESS_KEY')
  const accessKeySecret = ctx.secret('ARK_TOS_SECRET_KEY')
  if (!accessKeyId || !accessKeySecret)
    throw new ProviderError(
      'invalid_input',
      '火山视频参考需要在模型平台设置中配置存储桶、地域和存储 Access Key / Secret Key',
    )
  return async (file: ReferenceFile) => {
    const Client = await loadTosClient()
    const client = new Client({
      bucket,
      region,
      endpoint: `tos-${region}.volces.com`,
      accessKeyId,
      accessKeySecret,
      secure: true,
    })
    const key = objectKey(file.data, file.mime, prefix)
    let url: string
    try {
      url = client.getPreSignedUrl({ key, method: 'PUT', expires: PUT_EXPIRES })
    } catch {
      throw new ProviderError('invalid_input', 'TOS 参考视频签名失败；尚未提交视频生成')
    }
    await put(ctx, 'TOS', url, file)
    return client.getPreSignedUrl({ key, method: 'GET', expires: GET_EXPIRES })
  }
}

/**
 * S3 兼容存储（阿里云 OSS / 腾讯云 COS / 自建 MinIO）上传。
 *
 * 用本文件里的 SigV4 预签名，不需要额外的 SDK。
 */
export function s3Uploader(
  ctx: AdapterContext,
  storage: ReferenceStorage,
  region: string,
): ReferenceUpload {
  const target = s3Target(storage)
  if (!target)
    throw new ProviderError(
      'invalid_input',
      storage.referenceStorage === 's3'
        ? 'S3 兼容存储地址须为不带路径的 https 地址，桶名须为小写字母、数字、点或连字符'
        : '存储地域或桶名格式不正确：地域如 cn-hangzhou / ap-guangzhou，桶名为小写字母、数字、点或连字符',
    )
  const accessKeyId = ctx.secret('ARK_TOS_ACCESS_KEY')
  const secretAccessKey = ctx.secret('ARK_TOS_SECRET_KEY')
  if (!accessKeyId || !secretAccessKey)
    throw new ProviderError(
      'invalid_input',
      '火山视频参考需要在模型平台设置中配置存储桶、地域和存储 Access Key / Secret Key',
    )
  return async (file: ReferenceFile) => {
    const path = `${target.prefix}/${objectKey(file.data, file.mime, storage.referenceKeyPrefix)}`
    const sign = (method: 'PUT' | 'GET', expires: number) =>
      presignS3({
        method,
        host: target.host,
        path,
        region,
        accessKeyId,
        secretAccessKey,
        expires,
        now: new Date(),
      })
    // 阿里云 OSS 的 S3 兼容 V4 请求要求声明不签负载；其他 S3 兼容存储也接受
    await put(ctx, 'S3 兼容存储', sign('PUT', PUT_EXPIRES), file, {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    })
    return sign('GET', GET_EXPIRES)
  }
}

/**
 * 按配置选上传后端：TOS 走官方 SDK，其余走 S3 兼容签名。
 */
export function referenceUploader(ctx: AdapterContext, storage: ReferenceStorage): ReferenceUpload {
  const bucket = storage.referenceBucket.trim()
  const region = storage.referenceRegion.trim()
  if (!bucket || !region)
    throw new ProviderError(
      'invalid_input',
      '火山视频参考需要在模型平台设置中配置存储桶、地域和存储 Access Key / Secret Key',
    )
  return storage.referenceStorage === 'tos'
    ? tosUploader(ctx, bucket, region, storage.referenceKeyPrefix)
    : s3Uploader(ctx, storage, region)
}

/**
 * 从宿主配置读取参考视频存储设置。
 *
 * 宿主给了 `ctx.settings`（plein 的设置对象，字段同名）就直接读，缺省值与 plein 一致
 * （`tos`、`cn-beijing`）；没有 settings（MCP / CLI）时回退到 `ARK_REFERENCE_*` env / secret。
 */
export function referenceStorageFrom(ctx: AdapterContext): ReferenceStorage {
  if (ctx.settings) {
    const text = (value: unknown, fallback = '') =>
      typeof value === 'string' ? value.trim() : fallback
    const storage = text(ctx.settings.referenceStorage, 'tos') || 'tos'
    if (storage !== 'tos' && storage !== 'oss' && storage !== 'cos' && storage !== 's3')
      throw new ProviderError('invalid_input', '火山视频参考存储类型须为 tos / oss / cos / s3')
    const prefix = text(ctx.settings.referenceKeyPrefix)
    return {
      referenceStorage: storage,
      referenceEndpoint: text(ctx.settings.referenceEndpoint),
      referencePathStyle: ctx.settings.referencePathStyle === true,
      referenceBucket: text(ctx.settings.referenceBucket),
      referenceRegion: text(ctx.settings.referenceRegion, 'cn-beijing') || 'cn-beijing',
      ...(prefix ? { referenceKeyPrefix: prefix } : {}),
    }
  }
  const storage = ctx.secret(REFERENCE_STORAGE_KEYS.storage)?.trim()
  if (storage !== 'tos' && storage !== 'oss' && storage !== 'cos' && storage !== 's3')
    throw new ProviderError(
      'invalid_input',
      `火山视频参考需要配置参考存储类型（${REFERENCE_STORAGE_KEYS.storage}）：tos / oss / cos / s3`,
    )
  const prefix = ctx.secret(REFERENCE_STORAGE_KEYS.keyPrefix)?.trim()
  return {
    referenceStorage: storage,
    referenceEndpoint: ctx.secret(REFERENCE_STORAGE_KEYS.endpoint)?.trim() ?? '',
    referencePathStyle: ctx.secret(REFERENCE_STORAGE_KEYS.pathStyle) === 'true',
    referenceBucket: ctx.secret(REFERENCE_STORAGE_KEYS.bucket)?.trim() ?? '',
    referenceRegion: ctx.secret(REFERENCE_STORAGE_KEYS.region)?.trim() ?? '',
    ...(prefix ? { referenceKeyPrefix: prefix } : {}),
  }
}

/**
 * 参考视频上传实现：注入给 `createArkAdapter(models, { uploadVideo })`。
 *
 * 存储配置与密钥都在调用时从 `ctx` 读，所以适配器不需要知道对象存储的细节；
 * 上传失败会在提交视频生成之前报错。
 */
export async function uploadReferenceVideo(
  ctx: AdapterContext,
  file: ReferenceFile,
): Promise<string> {
  return referenceUploader(ctx, referenceStorageFrom(ctx))(file)
}
