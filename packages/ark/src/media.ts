/**
 * Ark image / video request construction and response parsing, plus the async
 * video task lifecycle (submit → poll → cancel) and the OpenAI-compatible
 * model-list parser. All HTTP goes through `request()` so fixtures can replay it.
 *
 * 上限（张数、参考图数量、分辨率、像素区间、时长、画幅、seed）一律读模型声明
 * （`ModelLimits` / `optionsSchema`），代码里不写型号字面量；声明里没写的项不校验。
 */
import {
  ProviderError,
  fromBase64,
  mediaRequirementProblems,
  toBase64,
  videoReferenceProblem,
  videoReferencePrompt,
  type AdapterContext,
  type AssetRef,
  type CapabilityInput,
  type LoadedFile,
  type ModelLimits,
  type PollResult,
  type ProviderOutput,
  type RemoteModel,
  type SubmitResult,
} from '@modelbay/core'
import { sizeByArea, tierEdge, videoReferences } from '@modelbay/shared'
import { extraParams } from './chat'
import { hasFiles, imageData, readFile } from './files'
import {
  asJson,
  errorInfo,
  request,
  type ErrorClassifier,
  type Json,
  type TransportMessages,
} from './http'
import type { ReferenceVideoUploader } from './reference'

export { ratioOf, sizeByArea, tierEdge } from '@modelbay/shared'

/** 产物 URL 允许的下载域名（`*.x` 只匹配子域名，不含根域名）。 */
export const RESULT_HOSTS = ['*.volces.com', '*.byteimg.com', '*.ibytedtos.com', '*.byteicdn.com']

function domainAllowed(allowed: readonly string[], hostname: string): boolean {
  const host = hostname.toLowerCase()
  return allowed.some((entry) =>
    entry.startsWith('*.')
      ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1
      : host === entry,
  )
}

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

const PIXELS = /^([1-9][0-9]*)x([1-9][0-9]*)$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** 单次请求里图片张数的兜底上限（声明里没写 `count` 时）。 */
const DEFAULT_MAX_COUNT = 15
/** 声明里没写 `references` 时，参考图的兜底上限。 */
const DEFAULT_MAX_REFERENCES = 10

/**
 * Seedream image generation request body.
 *
 * `model` 是目标渠道的渠道内 ID（请求体里用这个）；`limits` 是模型声明里的上限。
 */
export async function imageBody(
  model: string,
  input: CapabilityInput<'image.generate'>,
  ctx: AdapterContext,
  limits: ModelLimits,
  defaultResolution: string,
): Promise<Json> {
  if (!input.prompt.trim()) invalid('图片提示词不能为空')
  if (input.negativePrompt) invalid('Seedream 不支持独立 negativePrompt，请合并到 prompt')
  if (input.seed !== undefined && limits.seed === false) invalid('所选模型不支持 seed')
  const count = input.count ?? 1
  const maxCount = limits.count?.max ?? DEFAULT_MAX_COUNT
  if (!Number.isInteger(count) || count < 1) invalid(`图片数量必须为 1–${maxCount} 的整数`)
  if (count > maxCount)
    invalid(
      maxCount === 1
        ? '所选模型仅支持单图；多图请选支持组图的模型'
        : `所选模型一次最多生成 ${maxCount} 张`,
    )
  const refs = input.references ?? []
  const maxRefs = limits.references?.max ?? DEFAULT_MAX_REFERENCES
  if (refs.length > maxRefs) invalid(`所选模型最多接受 ${maxRefs} 张参考图`)
  const maxTotal = limits.image?.maxTotalImages ?? DEFAULT_MAX_COUNT
  if (count > 1 && refs.length + count > maxTotal)
    invalid(`所选模型的参考图与生成图片合计最多 ${maxTotal} 张`)

  const body: Json = {
    // 云端默认开启；作为下游视频参考的图片默认不叠加可见水印。
    watermark: false,
    ...extraParams(input.extra, [
      'aspectRatio',
      'size',
      'watermark',
      'output_format',
      'optimize_prompt_options',
    ]),
    model,
    prompt: input.prompt,
    response_format: 'b64_json',
  }
  const aspectRatio = body.aspectRatio
  delete body.aspectRatio
  // 未选分辨率时使用模型默认档位；固定画幅与显式选择走同一尺寸换算。
  if (body.size === undefined && input.width === undefined && input.height === undefined) {
    const resolution = input.resolution ?? defaultResolution
    const edge = tierEdge(resolution)
    // 声明里写了分辨率档位才校验这一项；没写就按声明的默认档位换算。
    if ((limits.resolutions && !limits.resolutions.includes(resolution)) || !edge)
      invalid('所选模型不支持该分辨率')
    const { width, height } = sizeByArea(String(aspectRatio ?? '1:1'), edge * edge)
    // 智能画幅只给档位，比例由模型按提示词决定
    body.size = aspectRatio === 'auto' ? resolution : `${width}x${height}`
  }
  if (body.size === undefined && (input.width !== undefined || input.height !== undefined)) {
    if (
      !Number.isInteger(input.width) ||
      !Number.isInteger(input.height) ||
      (input.width ?? 0) < 1 ||
      (input.height ?? 0) < 1
    )
      invalid('图片宽高必须同时指定为正整数')
    // 像素与宽高比范围统一在下面按 size 校验
    body.size = `${input.width}x${input.height}`
  }
  const sizeRule = limits.image?.size
  if (body.size !== undefined && sizeRule) {
    const tiers = sizeRule.tiers ?? limits.resolutions
    const dimensions = typeof body.size === 'string' ? PIXELS.exec(body.size) : null
    if (dimensions) {
      const width = Number(dimensions[1])
      const height = Number(dimensions[2])
      if (
        width * height < sizeRule.minPixels ||
        width * height > sizeRule.maxPixels ||
        width / height < sizeRule.minRatio ||
        width / height > sizeRule.maxRatio
      )
        invalid('图片尺寸超出所选模型的像素 / 宽高比范围')
    } else if (tiers && !tiers.includes(String(body.size))) invalid('所选模型不支持该 size')
  }
  if (input.seed !== undefined) body.seed = input.seed
  if (refs.length) {
    const images = await Promise.all(refs.map((ref) => imageData(ctx, ref)))
    body.image = images.length === 1 ? images[0] : images
  }
  if (count > 1) {
    body.sequential_image_generation = 'auto'
    body.sequential_image_generation_options = { max_images: count }
  }
  return body
}

/** Validate a product URL against the download allow-list. */
function remoteFile(url: unknown, kind: 'image' | 'video', mime: string): ProviderOutput {
  if (typeof url !== 'string' || !url)
    throw new ProviderError('unknown', '火山方舟响应缺少产物 URL')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ProviderError('unknown', '火山方舟返回无效产物 URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !domainAllowed(RESULT_HOSTS, parsed.hostname)
  )
    throw new ProviderError('unknown', '火山方舟产物 URL 超出允许的下载域名')
  return { type: 'file', kind, mime, url }
}

/** Parse `/images/generations` response into file outputs. */
export function parseImageResponse(
  data: Json,
  opts: { key?: string; outputFormat?: unknown } = {},
): SubmitResult {
  const items = Array.isArray(data.data) ? data.data : []
  if (!items.length) throw new ProviderError('unknown', '火山方舟响应缺少图片')
  const outputs = items.map((item): ProviderOutput => {
    const result = asJson(item)
    if (result.error) {
      const error = errorInfo(result.error, 0, '火山方舟', [opts.key])
      throw new ProviderError(error.code, error.message, { retryable: false })
    }
    const format = result.output_format ?? opts.outputFormat ?? 'jpeg'
    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    if (typeof result.b64_json === 'string' && result.b64_json.length) {
      const encoded = result.b64_json.replace(/^data:image\/[a-z]+;base64,/, '')
      if (!BASE64.test(encoded)) throw new ProviderError('unknown', '火山方舟返回无效图片 Base64')
      return { type: 'file', kind: 'image', mime, data: fromBase64(encoded) }
    }
    return remoteFile(result.url, 'image', mime)
  })
  return { state: 'succeeded', outputs, usage: { images: outputs.length } }
}

/** Seedream layer-decomposition (cutout) request body. */
export async function cutoutBody(
  model: string,
  input: CapabilityInput<'image.process'>,
  ctx: AdapterContext,
  /** 模型声明的上限；`media.process` 是原图要求 */
  limits: ModelLimits = {},
  title = '当前模型',
): Promise<Json> {
  if (input.operation !== 'cutout') invalid('当前 Seedream 精修仅支持透明图层抠图')
  if (input.image.kind !== 'image') invalid('图层抠图需要图片原图')
  const source: LoadedFile = await readFile(ctx, input.image)
  if (!source.data.length) invalid('图层抠图原图不能是空文件')
  // 原图要求以模型声明为准，宿主在运行前读的是同一份声明；
  // 只有字节没有元数据（MCP 素材库）时不能要求尺寸信息
  const problems = mediaRequirementProblems(
    limits.media?.process,
    { mime: source.mime, size: source.data.length, width: source.width, height: source.height },
    { title, label: '图层抠图原图', strict: hasFiles(ctx) },
  )
  if (problems.length) invalid(problems[0]!)
  return {
    model,
    image: `data:${source.mime};base64,${toBase64(source.data)}`,
    prompt: input.prompt ?? '',
    layer_decomposition: true,
    output_format: 'png',
    response_format: 'b64_json',
  }
}

/** Parse layer-decomposition results into transparent PNG layers + layer metadata. */
export function parseCutoutResponse(data: Json): SubmitResult {
  if (!Array.isArray(data.data)) throw new ProviderError('unknown', '未返回图层结果')
  const layers = data.data.map(asJson)
  const indices = new Set<number>()
  for (const layer of layers) {
    const index = layer.z_index
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 16 ||
      indices.has(index)
    )
      throw new ProviderError('unknown', '图层顺序信息无效；不会自动重提')
    indices.add(index)
    if (layer.bounding_box !== undefined) {
      const box = asJson(layer.bounding_box)
      for (const coordinates of [box.absolute, box.normalized]) {
        if (
          coordinates !== undefined &&
          (!Array.isArray(coordinates) ||
            coordinates.length !== 4 ||
            coordinates.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
        )
          throw new ProviderError('unknown', '图层边界信息无效；不会自动重提')
      }
    }
  }
  const outputs: ProviderOutput[] = layers
    .filter((layer) => typeof layer.z_index === 'number' && layer.z_index > 0)
    .map((layer) => {
      if (typeof layer.b64_json === 'string') {
        const encoded = layer.b64_json.replace(/^data:image\/png;base64,/, '')
        if (!BASE64.test(encoded) || encoded.length % 4 === 1)
          throw new ProviderError('unknown', '图层图片数据无效')
        return {
          type: 'file',
          kind: 'image' as const,
          mime: 'image/png',
          data: fromBase64(encoded),
          name: typeof layer.name === 'string' ? layer.name + '.png' : '主体图层.png',
        }
      }
      return remoteFile(layer.url, 'image', 'image/png')
    })
  if (!outputs.length)
    throw new ProviderError('unknown', '未返回独立透明图层，请在平台核对结果；不会自动重提')
  outputs.push({
    type: 'json',
    value: {
      layers: layers.map(({ z_index, bounding_box, name, description }) => ({
        z_index,
        bounding_box,
        name,
        description,
      })),
    },
  })
  return { state: 'succeeded', outputs }
}

/** 参考音频的 MIME 在 data URL 里要写成平台认的子类型（只认 wav / mp3）。 */
const AUDIO_FORMAT: Record<string, string> = {
  'audio/x-wav': 'audio/wav',
  'audio/mpeg': 'audio/mp3',
}

/**
 * 只有 `ctx.assets`（没有时长 / 编码元数据）时的参考素材编码：
 * 图片与音频走 data URL，视频先交给注入的上传实现换成限时地址。
 * 有 `ctx.files` 时不走这里，改用与宿主一致的完整素材校验（`videoReferences`）。
 */
async function assetReferences(
  ctx: AdapterContext,
  refs: AssetRef[],
  uploadVideo: ReferenceVideoUploader | undefined,
): Promise<Json[]> {
  const content: Json[] = []
  for (const ref of refs) {
    if (ref.kind === 'video') {
      if (!uploadVideo)
        invalid(
          '火山方舟参考视频需要上传到对象存储：请从 @modelbay/ark/tos 引入 uploadReferenceVideo，' +
            '再用 createArkAdapter(models, { uploadVideo: uploadReferenceVideo }) 注入',
        )
      const file = await readFile(ctx, ref)
      if (!file.data.length) invalid('参考视频不能是空文件')
      content.push({
        type: 'video_url',
        video_url: {
          url: await uploadVideo(ctx, { data: file.data, mime: file.mime || 'video/mp4' }),
        },
        role: 'reference_video',
      })
    } else if (ref.kind === 'audio') {
      const file = await readFile(ctx, ref)
      const mime = file.mime.toLowerCase()
      content.push({
        type: 'audio_url',
        audio_url: { url: `data:${AUDIO_FORMAT[mime] ?? mime};base64,${toBase64(file.data)}` },
        role: 'reference_audio',
      })
    } else {
      content.push({
        type: 'image_url',
        image_url: { url: await imageData(ctx, ref) },
        role: 'reference_image',
      })
    }
  }
  return content
}

/** 方舟视频任务的 `extra` 白名单（`generate_audio` 是 MCP `generate_video` 的 audio 参数）。 */
const VIDEO_EXTRA = [
  'generate_audio',
  'watermark',
  'return_last_frame',
  'service_tier',
  'execution_expires_after',
  'draft',
  'output_format',
  'omni_reference_task_type',
]

const TASK_TYPES = ['auto', 'reference', 'edit', 'extend']

export interface VideoBodyOptions {
  plane: 'api' | 'plan'
  /** 请求体里的模型名 */
  model: string
  input: CapabilityInput<'video.generate'>
  ctx: AdapterContext
  defaultResolution: string
  /** 模型声明的上限（`duration` / `resolutions` / `aspectRatios` / `referenceMedia` / `media` 等） */
  limits: ModelLimits
  /** 模型声明的专属参数 schema；用它判断是否支持参考任务类型 / 草稿 */
  optionsSchema?: Record<string, unknown>
  /** 模型显示名，素材校验文案里用 */
  title?: string
  /** 参考视频上传实现（Node 子路径注入）；缺视频参考时不需要。 */
  uploadVideo?: ReferenceVideoUploader
}

function optionNames(schema: Record<string, unknown> | undefined): Set<string> {
  return new Set(Object.keys(asJson(schema?.properties)))
}

/** Seedance video generation request body. */
export async function videoBody(opts: VideoBodyOptions): Promise<Json> {
  const { plane, model, input, ctx, limits } = opts
  const title = opts.title ?? '当前模型'
  const options = optionNames(opts.optionsSchema)
  if (!input.prompt.trim() && !input.firstFrame && !input.references?.length)
    invalid('视频需要提示词或图片参考')
  if (input.lastFrame && !input.firstFrame) invalid('尾帧需要同时提供首帧')
  if ((input.firstFrame || input.lastFrame) && input.references?.length)
    invalid('首尾帧与参考图不能混用')
  const { adaptive_duration, ...extra } = input.extra ?? {}
  if (adaptive_duration !== undefined && typeof adaptive_duration !== 'boolean')
    invalid('自动时长必须为布尔值')
  const body: Json = {
    ...extraParams(extra, VIDEO_EXTRA),
    ...(input.audio !== undefined ? { generate_audio: input.audio } : {}),
    model,
    content: [],
    resolution: input.resolution ?? opts.defaultResolution,
    ratio:
      input.aspectRatio === 'auto'
        ? 'adaptive'
        : (input.aspectRatio ?? (input.firstFrame ? 'adaptive' : '16:9')),
  }
  const range = typeof limits.duration === 'object' ? limits.duration : undefined
  // 声明了参考任务类型的模型：首帧与编辑 / 延长任务统一保持输入比例
  const omni = options.has('omni_reference_task_type')
  const taskType = input.extra?.omni_reference_task_type
  if (taskType !== undefined && (!omni || !TASK_TYPES.includes(String(taskType))))
    invalid('参考任务类型仅支持声明了该选项的模型（auto / reference / edit / extend）')
  if (taskType && !input.references?.length) invalid('参考任务类型需要使用多模态参考模式')
  if (taskType === 'edit' || taskType === 'extend') {
    if (!input.references?.some((ref) => ref.kind === 'video'))
      invalid('编辑或延长任务需要参考视频')
    body.ratio = 'adaptive'
  }

  if (input.seed !== undefined && limits.seed === false) invalid(`${title} 不支持 seed`)
  if (input.duration !== undefined) {
    if (
      !Number.isInteger(input.duration) ||
      (range && input.duration !== -1 && (input.duration < range.min || input.duration > range.max))
    )
      invalid(
        range
          ? `${title} 时长必须为 -1 或 ${range.min}–${range.max} 的整数秒`
          : `${title} 时长必须为整数秒`,
      )
    body.duration = input.duration
  }
  if (taskType === 'edit' || (range && adaptive_duration === true)) body.duration = -1
  if (input.seed !== undefined) body.seed = input.seed
  if (limits.aspectRatios) {
    const ratios = limits.aspectRatios.map((value) => (value === 'auto' ? 'adaptive' : value))
    if (!ratios.includes(String(body.ratio))) invalid(`${title} 不支持该宽高比`)
  }
  if (omni && input.firstFrame) body.ratio = 'adaptive'
  if (limits.resolutions && !limits.resolutions.includes(String(body.resolution)))
    invalid(`${title} 不支持该分辨率`)
  if (body.draft && plane === 'plan') invalid('Agent Plan 不支持 Seedance 草稿模式')
  if (body.draft && (!options.has('draft') || body.resolution !== '480p'))
    invalid('draft 仅支持声明了草稿模式的模型的 480p 输出')
  // 输出格式以模型声明为准，宿主在运行前读的是同一份声明
  if (
    body.output_format !== undefined &&
    (!['mp4', 'mov'].includes(String(body.output_format)) ||
      (limits.outputFormats && !limits.outputFormats.includes(String(body.output_format))))
  )
    invalid(`${title} 不支持该 output_format`)
  const counts = { image: 0, video: 0, audio: 0 }
  for (const ref of input.references ?? [])
    if (ref.kind === 'image' || ref.kind === 'video' || ref.kind === 'audio') counts[ref.kind]++
  const referenceProblem = videoReferenceProblem(input.prompt, counts)
  if (referenceProblem) invalid(referenceProblem)

  const content: Json[] = input.prompt.trim()
    ? [{ type: 'text', text: videoReferencePrompt(input.prompt, 'ark') }]
    : []
  for (const [ref, role] of [
    [input.firstFrame, 'first_frame'],
    [input.lastFrame, 'last_frame'],
  ] as Array<readonly [AssetRef | undefined, string]>) {
    if (ref)
      content.push({ type: 'image_url', image_url: { url: await imageData(ctx, ref) }, role })
  }
  if (input.references?.length) {
    const media = limits.referenceMedia
    if (!media && input.references.some((ref) => ref.kind !== 'image'))
      invalid('当前模型不支持视频或音频参考')
    if (hasFiles(ctx)) {
      const upload = opts.uploadVideo
      content.push(
        ...(await videoReferences(input.references, ctx, {
          image: limits.references?.max ?? 9,
          video: media?.video ?? 0,
          audio: media?.audio ?? 0,
          allowAudioOnly: media?.audioOnly === true,
          platform: 'ark',
          requirements: limits.media,
          title,
          ...(taskType === 'edit' ? { videoTask: 'edit' } : {}),
          ...(upload && input.references.some((ref) => ref.kind === 'video')
            ? { uploadVideo: (_ref: AssetRef, file: LoadedFile) => upload(ctx, file) }
            : {}),
        })),
      )
    } else {
      content.push(...(await assetReferences(ctx, input.references, opts.uploadVideo)))
    }
  }
  body.content = content
  return body
}

export interface TaskOptions {
  ctx: AdapterContext
  plane: 'api' | 'plan'
  base: string
  key: string
  label: string
  messages: TransportMessages
  classify?: ErrorClassifier
}

function taskHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/** Submit a video task; the platform answers with a remote id to poll. */
export async function submitVideo(body: Json, opts: TaskOptions): Promise<SubmitResult> {
  const data = await request({
    ctx: opts.ctx,
    url: `${opts.base}/contents/generations/tasks`,
    method: 'POST',
    headers: taskHeaders(opts.key),
    body: JSON.stringify(body),
    label: opts.label,
    messages: opts.messages,
    secrets: [opts.key],
    classify: opts.classify,
    retries: 0,
  })
  if (typeof data.id !== 'string' || !data.id)
    throw new ProviderError('unknown', '火山方舟响应缺少任务 ID；不会自动重新提交')
  return { state: 'pending', remoteId: data.id, pollAfterMs: 5000 }
}

function taskPath(remoteId: string): string {
  return `/contents/generations/tasks/${encodeURIComponent(remoteId)}`
}

/** Parse a video task status into a normalized poll result. */
export function parseTaskStatus(
  data: Json,
  opts: { key?: string; label?: string } = {},
): PollResult {
  if (data.status === 'succeeded') {
    const content = asJson(data.content)
    const mov = data.output_format === 'mov'
    const outputs: ProviderOutput[] = [
      remoteFile(content.video_url, 'video', mov ? 'video/quicktime' : 'video/mp4'),
    ]
    if (typeof content.last_frame_url === 'string' && content.last_frame_url)
      outputs.push(remoteFile(content.last_frame_url, 'image', 'image/jpeg'))
    return {
      state: 'succeeded',
      outputs,
      usage: {
        ...(typeof data.duration === 'number' ? { seconds: data.duration as number } : {}),
        ...(typeof asJson(data.usage).completion_tokens === 'number'
          ? { outputTokens: asJson(data.usage).completion_tokens as number }
          : {}),
      },
    }
  }
  if (['failed', 'cancelled', 'expired'].includes(String(data.status))) {
    // 与提交失败同一套归类（quota / auth / content_policy ...），任务级失败不可重试
    const error = errorInfo(
      data.error ?? { code: data.status, message: `火山方舟视频任务 ${String(data.status)}` },
      0,
      opts.label ?? '火山方舟',
      [opts.key],
    )
    return {
      state: 'failed',
      error: { code: error.code, message: error.message, retryable: false },
    }
  }
  if (data.status !== 'queued' && data.status !== 'running')
    throw new ProviderError('unknown', '火山方舟返回未知任务状态')
  return {
    state: 'pending',
    pollAfterMs: 5000,
    remote: data.status === 'queued' ? 'queued' : 'running',
  }
}

/** Poll a video task by remote id. */
export async function pollVideo(remoteId: string, opts: TaskOptions): Promise<PollResult> {
  const data = await request({
    ctx: opts.ctx,
    url: `${opts.base}${taskPath(remoteId)}`,
    method: 'GET',
    headers: taskHeaders(opts.key),
    label: opts.label,
    messages: opts.messages,
    secrets: [opts.key],
    classify: opts.classify,
    toleratedStatuses: ['failed', 'cancelled', 'expired'],
  })
  return parseTaskStatus(data, { key: opts.key, label: opts.label })
}

/** Cancel a queued video task; running tasks cannot be cancelled. */
export async function cancelVideo(remoteId: string, opts: TaskOptions): Promise<void> {
  const data = await request({
    ctx: opts.ctx,
    url: `${opts.base}${taskPath(remoteId)}`,
    method: 'GET',
    headers: taskHeaders(opts.key),
    label: opts.label,
    messages: opts.messages,
    secrets: [opts.key],
    classify: opts.classify,
    toleratedStatuses: ['failed', 'cancelled', 'expired'],
    retries: 0,
  })
  if (data.status === 'queued') {
    await request({
      ctx: opts.ctx,
      url: `${opts.base}${taskPath(remoteId)}`,
      method: 'DELETE',
      headers: taskHeaders(opts.key),
      label: opts.label,
      messages: opts.messages,
      secrets: [opts.key],
      classify: opts.classify,
      retries: 0,
    })
    return
  }
  if (data.status === 'running')
    throw new ProviderError('invalid_input', '火山方舟不支持取消已经运行的视频任务')
  if (!['succeeded', 'failed', 'cancelled', 'expired'].includes(String(data.status)))
    throw new ProviderError('unknown', '火山方舟返回未知任务状态，未执行取消')
}

/** OpenAI-compatible model list: `{ data: [{ id, owned_by?, created? }] }`. */
export function openAiModelList(value: unknown): RemoteModel[] {
  const items = asJson(value).data
  if (!Array.isArray(items)) throw new ProviderError('unknown', '模型列表响应缺少 data 数组')
  return items.flatMap((item) => {
    const entry = asJson(item)
    if (typeof entry.id !== 'string' || !entry.id) return []
    return [
      {
        id: entry.id,
        ...(typeof entry.owned_by === 'string' && entry.owned_by
          ? { ownedBy: entry.owned_by }
          : {}),
        ...(typeof entry.created === 'number' ? { created: entry.created } : {}),
      },
    ]
  })
}
