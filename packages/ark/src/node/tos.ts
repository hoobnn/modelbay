/**
 * Node-only reference-video upload helpers, exported from `@modelbay/ark/tos`.
 * Root entry never imports this file: it uses `node:crypto` / `Buffer` and the
 * TOS SDK, which are not available in browsers or Deno.
 */
import { createHash, createHmac } from 'node:crypto'
import { ProviderError, type AdapterContext } from '@modelbay/core'

export interface ReferenceStorage {
  referenceStorage: 'tos' | 'oss' | 'cos' | 's3'
  referenceEndpoint: string
  referencePathStyle: boolean
  referenceBucket: string
  referenceRegion: string
}

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

/** Deterministic object key from the asset bytes. */
export function objectKey(data: Uint8Array, mime: string): string {
  const hash = createHash('sha256').update(data).digest('hex')
  return `modelbay/video-references/${hash}.${mime === 'video/quicktime' ? 'mov' : 'mp4'}`
}

/**
 * TODO(M3): the actual TOS uploader needs `@volcengine/tos-sdk` (a Node-only
 * dependency to be installed by the integrator) plus the host's `ctx.fetch`
 * proxy. Until then the subpath exposes the interface and a clear error so the
 * root adapter stays runtime-agnostic.
 */
export function tosUploader(_ctx: AdapterContext, _bucket: string, _region: string): never {
  throw new ProviderError(
    'unavailable',
    'TODO: TOS 参考视频上传需要 @volcengine/tos-sdk，请在 Node 子路径接入后再用',
  )
}
