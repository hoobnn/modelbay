/**
 * Ark image / video request construction and response parsing, plus the async
 * video task lifecycle (submit → poll → cancel) and the OpenAI-compatible
 * model-list parser. All HTTP goes through `request()` so fixtures can replay it.
 */
import {
  ProviderError,
  fromBase64,
  type AdapterContext,
  type CapabilityInput,
  type ProviderOutput,
  type SubmitResult,
  type PollResult,
  type RemoteModel,
} from '@modelbay/core'
import { asJson, request, type ErrorClassifier, type Json, type TransportMessages } from './http'
import { imageDataUrl } from './chat'

/** `16:9` → 16/9, unrecognised values fall back to 1. */
export function ratioOf(aspect: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? '')
  return match ? Number(match[1]) / Number(match[2]) : 1
}

/** Width/height from a target pixel count and aspect, floored to a step. */
export function sizeByArea(aspect: string | undefined, pixels: number, step = 16) {
  const ratio = ratioOf(aspect)
  return {
    width: Math.floor(Math.sqrt(pixels * ratio) / step) * step,
    height: Math.floor(Math.sqrt(pixels / ratio) / step) * step,
  }
}

/** `2K` → 2048 (1K = 1024). */
export function tierEdge(tier: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)K$/i.exec(tier)
  return match ? Math.round(Number(match[1]) * 1024) : undefined
}

/** Plan channel uses its own model names for the image / video endpoints. */
export const PLAN_MODELS: Record<string, string> = {
  'doubao-seedream-5-0-pro-260628': 'doubao-seedream-5.0-pro',
  'doubao-seedream-5-0-flash-260915': 'doubao-seedream-5.0-flash',
  'doubao-seedance-2-5-260628': 'doubao-seedance-2.5',
  'doubao-seedance-2-0-260128': 'doubao-seedance-2.0',
  'doubao-seedance-2-0-fast-260128': 'doubao-seedance-2.0-fast',
  'doubao-seedance-2-0-mini-260615': 'doubao-seedance-2.0-mini',
}

/** Translate a model id for the plan data plane; custom ids pass through. */
export function wireModel(plane: 'api' | 'plan', model: string): string {
  return plane === 'plan' ? (PLAN_MODELS[model] ?? model) : model
}

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

function extraParams(extra: Json | undefined, allowed: string[]): Json {
  for (const key of Object.keys(extra ?? {})) {
    if (!allowed.includes(key)) invalid(`火山方舟不支持 extra.${key}；不能覆盖模型、输入或请求路由`)
  }
  return { ...extra }
}

/** Seedream image generation request body. */
export async function imageBody(
  plane: 'api' | 'plan',
  model: string,
  input: CapabilityInput<'image.generate'>,
  ctx: AdapterContext,
  defaultResolution: string,
): Promise<Json> {
  if (!input.prompt.trim()) invalid('图片提示词不能为空')
  if (input.negativePrompt) invalid('Seedream 不支持独立 negativePrompt，请合并到 prompt')
  const count = input.count ?? 1
  const lite = model === 'doubao-seedream-5-0-260128'
  if (!Number.isInteger(count) || count < 1 || count > 15) invalid('图片数量必须为 1–15 的整数')
  if (count > 1 && model.startsWith('doubao-seedream-5-') && !lite)
    invalid('Seedream Pro / Flash 仅支持单图；多图请选 Seedream Lite')
  const refs = input.references ?? []
  if (refs.length > (lite ? 14 : 10)) invalid(`所选模型最多接受 ${lite ? 14 : 10} 张参考图`)

  const body: Json = {
    watermark: false,
    ...extraParams(input.extra, [
      'aspectRatio',
      'size',
      'watermark',
      'output_format',
      'optimize_prompt_options',
    ]),
    model: wireModel(plane, model),
    prompt: input.prompt,
    response_format: 'b64_json',
  }
  const aspectRatio = body.aspectRatio
  delete body.aspectRatio
  if (body.size === undefined && input.width === undefined && input.height === undefined) {
    const resolution = input.resolution ?? defaultResolution
    const tokens = lite ? ['2K', '3K', '4K'] : ['1K', '1.5K', '2K']
    const edge = tierEdge(resolution)
    if (!model.startsWith('doubao-seedream-5-') || !tokens.includes(resolution) || !edge)
      invalid('所选 Seedream 模型不支持该分辨率')
    const { width, height } = sizeByArea(String(aspectRatio ?? '1:1'), edge * edge)
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
    body.size = `${input.width}x${input.height}`
  }
  if (input.seed !== undefined) body.seed = input.seed
  if (refs.length) {
    const images = await Promise.all(refs.map((ref) => imageDataUrl(ctx, ref, '火山方舟')))
    body.image = images.length === 1 ? images[0] : images
  }
  if (count > 1) {
    body.sequential_image_generation = 'auto'
    body.sequential_image_generation_options = { max_images: count }
  }
  return body
}

/** Validate and decode a product URL / base64 payload into a file output. */
function remoteFile(url: unknown, kind: 'image' | 'video', mime: string): ProviderOutput {
  if (typeof url !== 'string' || !url)
    throw new ProviderError('unknown', '火山方舟响应缺少产物 URL')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new Error('invalid')
  } catch {
    throw new ProviderError('unknown', '火山方舟返回无效产物 URL')
  }
  return { type: 'file', kind, mime, url }
}

/** Parse `/images/generations` response into file outputs. */
export function parseImageResponse(data: Json): SubmitResult {
  const items = Array.isArray(data.data) ? data.data : []
  if (!items.length) throw new ProviderError('unknown', '火山方舟响应缺少图片')
  const outputs = items.map((item): ProviderOutput => {
    const result = asJson(item)
    if (result.error) throw new ProviderError('unknown', '火山方舟图片生成返回业务错误')
    const format = result.output_format ?? 'jpeg'
    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    if (typeof result.b64_json === 'string' && result.b64_json.length) {
      const encoded = result.b64_json.replace(/^data:image\/[a-z]+;base64,/, '')
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new ProviderError('unknown', '火山方舟返回无效图片 Base64')
      return { type: 'file', kind: 'image', mime, data: fromBase64(encoded) }
    }
    return remoteFile(result.url, 'image', mime)
  })
  return { state: 'succeeded', outputs, usage: { images: outputs.length } }
}

/** Seedream layer-decomposition (cutout) request body. */
export async function cutoutBody(
  plane: 'api' | 'plan',
  model: string,
  input: CapabilityInput<'image.process'>,
  ctx: AdapterContext,
): Promise<Json> {
  if (input.operation !== 'cutout') invalid('当前 Seedream 精修仅支持透明图层抠图')
  const source = await imageDataUrl(ctx, input.image, '火山方舟')
  return {
    model: wireModel(plane, model),
    image: source,
    prompt: input.prompt ?? '',
    layer_decomposition: true,
    output_format: 'png',
    response_format: 'b64_json',
  }
}

/** Parse layer-decomposition results into transparent PNG layers + layer metadata. */
export function parseCutoutResponse(data: Json): SubmitResult {
  const items = Array.isArray(data.data) ? data.data : []
  if (!items.length) throw new ProviderError('unknown', '未返回图层结果')
  const layers = items.map(asJson)
  const indices = new Set<number>()
  for (const layer of layers) {
    if (
      typeof layer.z_index !== 'number' ||
      !Number.isInteger(layer.z_index) ||
      (layer.z_index as number) < 0 ||
      (layer.z_index as number) > 16 ||
      indices.has(layer.z_index as number)
    )
      throw new ProviderError('unknown', '图层顺序信息无效；不会自动重提')
    indices.add(layer.z_index as number)
  }
  const outputs: ProviderOutput[] = layers
    .filter((layer) => typeof layer.z_index === 'number' && (layer.z_index as number) > 0)
    .map((layer) => {
      if (typeof layer.b64_json === 'string') {
        const encoded = layer.b64_json.replace(/^data:image\/png;base64,/, '')
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
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
  if (!outputs.length) throw new ProviderError('unknown', '未返回独立透明图层')
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

/** Seedance video generation request body. */
export async function videoBody(
  plane: 'api' | 'plan',
  model: string,
  input: CapabilityInput<'video.generate'>,
  ctx: AdapterContext,
  defaultResolution: string,
): Promise<Json> {
  if (!input.prompt.trim() && !input.firstFrame && !input.references?.length)
    invalid('视频需要提示词或图片参考')
  if (input.lastFrame && !input.firstFrame) invalid('尾帧需要同时提供首帧')
  if ((input.firstFrame || input.lastFrame) && input.references?.length)
    invalid('首尾帧与参考图不能混用')
  const body: Json = {
    ...extraParams(input.extra, [
      'watermark',
      'return_last_frame',
      'service_tier',
      'execution_expires_after',
      'draft',
      'output_format',
      'omni_reference_task_type',
      'generate_audio',
    ]),
    ...(input.audio !== undefined ? { generate_audio: input.audio } : {}),
    model: wireModel(plane, model),
    content: [],
    resolution: input.resolution ?? defaultResolution,
    ratio:
      input.aspectRatio === 'auto'
        ? 'adaptive'
        : (input.aspectRatio ?? (input.firstFrame ? 'adaptive' : '16:9')),
  }
  if (input.duration !== undefined) body.duration = input.duration
  if (input.seed !== undefined) body.seed = input.seed
  if (body.draft && plane === 'plan') invalid('Agent Plan 不支持 Seedance 草稿模式')

  const content: Json[] = input.prompt.trim() ? [{ type: 'text', text: input.prompt }] : []
  for (const [ref, role] of [
    [input.firstFrame, 'first_frame'],
    [input.lastFrame, 'last_frame'],
  ] as Array<readonly [typeof input.firstFrame, string]>) {
    if (ref)
      content.push({
        type: 'image_url',
        image_url: { url: await imageDataUrl(ctx, ref, '火山方舟') },
        role,
      })
  }
  for (const ref of input.references ?? []) {
    content.push({
      type: 'image_url',
      image_url: { url: await imageDataUrl(ctx, ref, '火山方舟') },
      role: 'reference_image',
    })
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
export function parseTaskStatus(data: Json): PollResult {
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
    const error = asJson(data.error)
    return {
      state: 'failed',
      error: {
        code: 'unknown',
        message: String(error.message ?? `火山方舟视频任务 ${String(data.status)}`),
        retryable: false,
      },
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
  return parseTaskStatus(data)
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
