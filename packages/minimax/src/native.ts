/**
 * MiniMax-only native operations and their parameter schemas (declared by the adapter).
 */
import { ProviderError, toBase64 } from '@modelbay/core'
import { resolveModel, selectDefaultModel, selectNativeModel } from '@modelbay/core'
import type { AdapterContext, ModelDeclaration, RemoteModel } from '@modelbay/core'
import { minimaxModelList, redact } from '@modelbay/shared'
import { withFiles } from './files'
import { required, taskId } from './util'
import {
  apiKey,
  asJson,
  arr,
  baseUrl,
  errorCode,
  readJson,
  normalizeFileId,
  requestJson,
  requestMessages,
  send,
  withRetry,
  type Json,
} from './http'

export const CONTEXT_IR_PATH = '/v2/h3_context_ir'
export const IMAGE_CONTEXT_IR_PATH = '/v1/h3_image_context_ir'
/** 再生成目标分辨率：官方两种请求体里 resolution 必填，默认值 2K。 */
const REGENERATION_RESOLUTION = '2K'
export const RERENDER_PATH = '/v2/video_regeneration'
export const UPLOAD_PATH = '/v1/files/upload'
export const VOICE_CLONE_PATH = '/v1/voice_clone'
export const VOICE_DESIGN_PATH = '/v1/voice_design'
export const QUERY_PATH = '/v2/query/video_generation'
export const VIDEO_PATH = '/v2/video_generation'

export const MINIMAX_NATIVE_OPERATIONS = [
  'context-ir',
  'image-context-ir',
  'video-2k-rerender',
  'voice-clone',
  'voice-design',
  'upload-file',
  'list-video-tasks',
  'delete-video-task',
  'raw-request',
  'listModels',
] as const

export const nativeOperationSchemas: Record<string, Record<string, unknown>> = {
  'context-ir': {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      content: { type: 'array', items: { type: 'object' } },
      duration: { type: 'integer', default: 5 },
      ratio: { type: 'string' },
      parameters: { type: 'object' },
    },
  },
  'image-context-ir': {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      model: { type: 'string' },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: '参考图：公网 URL、mm_file://ID、data URI 或素材 ID；传了按图片编辑增强',
      },
      size: { type: 'string' },
      aspect_ratio: { type: 'string' },
      // 取值同模型声明的 resolutions，由 imageContextIr 按声明校验
      area: { type: 'string' },
    },
  },
  'video-2k-rerender': {
    type: 'object',
    properties: {
      source_task_id: { type: 'string' },
      content: { type: 'array', items: { type: 'object' } },
      parameters: { type: 'object' },
    },
  },
  'voice-clone': {
    type: 'object',
    required: ['voice_id'],
    properties: {
      voice_id: { type: 'string' },
      audio: { type: 'string', description: 'AssetRef id or a public URL' },
      file_id: {
        anyOf: [{ type: 'string' }, { type: 'integer' }],
        description: '已上传样本的 file_id（官方 int64，字符串或整数均可），与 audio 二选一',
      },
      text: { type: 'string' },
      noise_reduction: { type: 'boolean' },
      volume_normalization: { type: 'boolean' },
    },
  },
  'voice-design': {
    type: 'object',
    required: ['prompt', 'preview_text'],
    properties: {
      voice_id: { type: 'string', description: '可选；不传时平台自动生成并返回' },
      prompt: { type: 'string' },
      preview_text: { type: 'string' },
    },
  },
  'upload-file': {
    type: 'object',
    required: ['asset_id'],
    properties: {
      asset_id: { type: 'string' },
      purpose: { type: 'string' },
      mime: { type: 'string' },
    },
  },
  'list-video-tasks': {
    type: 'object',
    properties: {
      page_num: { type: 'integer' },
      page_size: { type: 'integer' },
      status: { type: 'string' },
      task_type: { type: 'string' },
      model: { type: 'string' },
    },
  },
  'delete-video-task': {
    type: 'object',
    required: ['task_id'],
    properties: { task_id: { type: 'string' } },
  },
  listModels: { type: 'object', properties: {} },
  'raw-request': {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'DELETE'] },
      body: { type: 'object' },
      query: { type: 'object' },
    },
  },
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function asRecord(value: unknown): Json {
  return asJson(value)
}

/** Build the H3-Context-IR request (structured enhanced prompt, not a video). */
export function buildContextIrRequest(params: Json): { path: string; body: Json } {
  const provided = arr(params.content).map(asJson)
  if (provided.length && asString(params.prompt))
    throw new ProviderError('invalid_input', 'content and prompt are mutually exclusive')
  const content = provided.length ? provided : [{ type: 'text', text: asString(params.prompt) }]
  if (
    !content.some(
      (item) => item.type === 'text' && typeof item.text === 'string' && String(item.text).trim(),
    )
  )
    throw new ProviderError('invalid_input', 'context-ir requires one non-empty text item')
  const duration = typeof params.duration === 'number' ? params.duration : 5
  if (!Number.isInteger(duration) || duration < 4 || duration > 15)
    throw new ProviderError('invalid_input', 'duration must be a 4-15 second integer')
  const ratio = asString(params.ratio, '16:9')
  const options = asRecord(params.parameters)
  if (Object.keys(options).some((key) => key !== 'callback_url'))
    throw new ProviderError('invalid_input', 'context-ir parameters only support callback_url')
  return {
    path: CONTEXT_IR_PATH,
    body: { model: 'MiniMax-H3', content, duration, ratio, ...options },
  }
}

/** Build the 2K video regeneration request (source task id or a base_video content array). */
export function buildRerenderRequest(params: Json): { path: string; body: Json } {
  const sourceTaskId = asString(params.source_task_id)
  const content = arr(params.content).map(asJson)
  if (sourceTaskId && content.length)
    throw new ProviderError('invalid_input', 'source_task_id and content are mutually exclusive')
  if (!sourceTaskId && !content.length)
    throw new ProviderError('invalid_input', 'provide source_task_id or content')
  const options = asRecord(params.parameters)
  if (Object.keys(options).some((key) => !['callback_url', 'aigc_watermark'].includes(key)))
    throw new ProviderError(
      'invalid_input',
      'regeneration parameters only support callback_url/aigc_watermark',
    )
  if (!sourceTaskId) {
    const baseVideos = content.filter(
      (item) => item.type === 'video_url' && item.role === 'base_video',
    )
    if (baseVideos.length !== 1)
      throw new ProviderError(
        'invalid_input',
        'content must contain exactly one role=base_video item',
      )
  }
  // 官方 POST /v2/video_regeneration：source_task_id 与 content 两种请求体的 resolution 都是必填，
  // 默认值 2K（2026-11-06 核对：https://platform.minimax.cn/docs/api-reference/video-generation-v2-regeneration）
  const body: Json = { model: 'MiniMax-H3', ...options, resolution: REGENERATION_RESOLUTION }
  if (sourceTaskId) body.source_task_id = sourceTaskId
  else body.content = content
  return { path: RERENDER_PATH, body }
}

/** POST an async native task and normalize the returned task id. */
export async function submitNativeTask(
  ctx: AdapterContext,
  op: 'context-ir' | 'video-2k-rerender',
  params: Json,
): Promise<Json> {
  const { path, body } =
    op === 'context-ir' ? buildContextIrRequest(params) : buildRerenderRequest(params)
  const data = await requestJson(ctx, path, body)
  const taskId = data.task_id
  if (taskId === undefined || (typeof taskId === 'number' && !Number.isSafeInteger(taskId)))
    throw new ProviderError('unknown', 'MiniMax submission is missing a usable task_id')
  const id = String(taskId)
  return { job_id: id, task_id: id, request_id: data.request_id }
}

/** Upload a local asset through FormData and return its `file_id`. */
export async function uploadFile(ctx: AdapterContext, params: Json): Promise<Json> {
  const assetId = asString(params.asset_id)
  if (!assetId) throw new ProviderError('invalid_input', 'asset_id is required')
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for uploads')
  const loaded = await ctx.assets.load(assetId)
  const mime = (loaded.mime || asString(params.mime)).toLowerCase()
  if (!loaded.data.length) throw new ProviderError('invalid_input', 'Upload asset is empty')
  const ext = mime.split('/')[1] ?? 'bin'
  const form = new FormData()
  form.set('purpose', asString(params.purpose, 'video_generation_input'))
  form.set('file', new Blob([new Uint8Array(loaded.data)], { type: mime }), `asset.${ext}`)
  const data = await requestJson(ctx, UPLOAD_PATH, form)
  const fileId = asJson(data.file).file_id
  // file_id 是 int64：超长整数已在 readJson 里按字符串保留，丢精度的数字不可用
  const usable = normalizeFileId(fileId)
  if (usable === undefined)
    throw new ProviderError('unknown', 'MiniMax upload returned no usable file_id')
  return { fileId: String(usable), data }
}

const CLONE_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
}

/** Voice cloning: upload the sample, then create the voice. */
export async function voiceClone(
  ctx: AdapterContext,
  params: Json,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const voiceId = asString(params.voice_id)
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId))
    throw new ProviderError('invalid_input', 'Invalid MiniMax voice_id')
  const audio = params.audio
  let fileId: string
  if (params.file_id !== undefined && params.file_id !== null && params.file_id !== '') {
    // 官方 file_id 为 integer(int64)，字符串或数字输入都接受，发送时按数字写出
    const normalized = normalizeFileId(params.file_id)
    if (normalized === undefined)
      throw new ProviderError('invalid_input', 'file_id must be a non-negative int64 integer')
    fileId = String(normalized)
  } else if (typeof audio === 'string' && /^https?:\/\//.test(audio)) {
    fileId = audio
  } else {
    const assetId = typeof audio === 'object' && audio !== null ? asJson(audio).assetId : undefined
    if (typeof assetId !== 'string')
      throw new ProviderError('invalid_input', 'audio must be an AssetRef or a URL')
    const mime = asString(params.mime, 'audio/mpeg')
    if (!CLONE_FORMATS[mime])
      throw new ProviderError('invalid_input', 'Clone sample must be MP3/M4A/WAV')
    const uploaded = await uploadFile(ctx, { asset_id: assetId, purpose: 'voice_clone', mime })
    fileId = uploaded.fileId as string
  }
  const body: Json = {
    file_id: fileId,
    voice_id: voiceId,
    need_noise_reduction: params.noise_reduction === true,
    need_volume_normalization: params.volume_normalization === true,
    ...(asString(params.text)
      ? {
          text: asString(params.text),
          model:
            asString(params.model) ||
            selectDefaultModel(models, 'audio.speech', 'minimax')?.channel.id ||
            '',
        }
      : {}),
  }
  const data = await requestJson(ctx, VOICE_CLONE_PATH, body)
  if (Number(asJson(data.base_resp).status_code ?? 0) !== 0)
    throw new ProviderError('unknown', 'MiniMax clone response has no success status', {
      outcome: 'unknown',
    })
  return { status: 'ready', voiceId, data }
}

/** Voice design from a text prompt (returns a generated voice id). */
export async function voiceDesign(ctx: AdapterContext, params: Json): Promise<Json> {
  const voiceId = asString(params.voice_id)
  const prompt = asString(params.prompt)
  const previewText = asString(params.preview_text)
  if (!prompt.trim() || prompt.length > 2000 || !previewText.trim() || previewText.length > 500)
    throw new ProviderError(
      'invalid_input',
      'prompt (<=2000) and preview_text (<=500) are required',
    )
  // 官方 POST /v1/voice_design：voice_id 可选，不传则自动生成并在响应里返回
  // （2026-11-06 核对：https://platform.minimax.cn/docs/api-reference/voice-design-design）
  const data = await requestJson(ctx, VOICE_DESIGN_PATH, {
    ...(voiceId ? { voice_id: voiceId } : {}),
    prompt,
    preview_text: previewText,
  })
  const generated = asString(data.voice_id)
  if (!generated)
    throw new ProviderError(
      'unknown',
      'MiniMax voice design returned no voice_id; check the platform before retrying',
      {
        outcome: 'unknown',
      },
    )
  return { status: 'ready', voiceId: generated, data }
}

/** Paginated cloud task list (last 7 days). */
export async function listVideoTasks(ctx: AdapterContext, params: Json): Promise<Json> {
  const pageNum = typeof params.page_num === 'number' ? params.page_num : 1
  const pageSize = typeof params.page_size === 'number' ? params.page_size : 20
  if (pageNum < 1 || pageSize < 1 || pageSize > 100)
    throw new ProviderError('invalid_input', 'page_num>=1, page_size 1-100')
  const data = await requestJson(ctx, QUERY_PATH, undefined, {
    method: 'GET',
    query: {
      page_num: pageNum,
      page_size: pageSize,
      'filter.status': asString(params.status) || undefined,
      'filter.task_type': asString(params.task_type) || undefined,
      // 官方文档只有 filter.model，没有顶层 model（2026-11-06 核对：
      // https://platform.minimax.cn/docs/api-reference/video-generation-v2-list）
      'filter.model': asString(params.model) || undefined,
    },
  })
  return data
}

/**
 * 取消 queued 任务或删除 succeeded / failed 任务记录；running / cancelled 由上游报错。
 * DELETE /v2/video_generation/{task_id}，2026-11-06 核对：
 * https://platform.minimax.cn/docs/api-reference/video-generation-v2-delete
 */
export async function deleteVideoTask(ctx: AdapterContext, params: Json): Promise<Json> {
  const id = taskId(params.task_id)
  return requestJson(ctx, `${VIDEO_PATH}/${id}`, undefined, { method: 'DELETE' })
}

/**
 * 远端模型列表（GET /v1/models）：条目键 `model` / `id` 都接受；
 * HTTP 200 里的业务错误（base_resp / error）不能当成空列表。对话模型统一补 structured 特性。
 */
export async function listModels(ctx: AdapterContext): Promise<RemoteModel[]> {
  const key = apiKey(ctx)
  const messages = requestMessages('GET')
  const res = await send(
    ctx,
    `${baseUrl(ctx)}/v1/models`,
    { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
    messages,
  )
  const body = await readJson(ctx, res, 'GET', messages)
  if (!res.ok)
    throw withRetry(
      new ProviderError(errorCode(res.status), `MiniMax 拉取模型列表失败（HTTP ${res.status}）`),
      'GET',
      res.status,
    )
  const data = asJson(body)
  const baseResp = asJson(data.base_resp)
  const statusCode = Number(baseResp.status_code ?? 0)
  const businessError = asJson(data.error)
  if (businessError.type || statusCode !== 0) {
    const code: string | number =
      typeof businessError.type === 'string' && businessError.type
        ? businessError.type
        : statusCode || res.status
    const message = redact(
      String(businessError.message ?? baseResp.status_msg ?? `HTTP ${res.status}`),
      [key],
    )
    throw new ProviderError(errorCode(code), `MiniMax：${message}`)
  }
  return minimaxModelList(data).map((model) => ({
    ...model,
    features: [...(model.features ?? []), 'structured' as const],
  }))
}

/** Dispatch a native operation. */
export async function runMinimaxNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<unknown> {
  const p = asJson(params)
  switch (op) {
    case 'context-ir':
      return submitNativeTask(ctx, 'context-ir', p)
    case 'image-context-ir':
      return imageContextIr(ctx, p, models)
    case 'video-2k-rerender':
      return submitNativeTask(ctx, 'video-2k-rerender', p)
    case 'voice-clone':
      return voiceClone(ctx, p, models)
    case 'voice-design':
      return voiceDesign(ctx, p)
    case 'upload-file':
      return uploadFile(ctx, p)
    case 'list-video-tasks':
      return listVideoTasks(ctx, p)
    case 'delete-video-task':
      return deleteVideoTask(ctx, p)
    case 'listModels':
      return listModels(ctx)
    case 'raw-request': {
      const path = asString(p.path)
      if (!path.startsWith('/'))
        throw new ProviderError('invalid_input', 'raw-request path must start with /')
      const method = (
        ['GET', 'POST', 'DELETE'].includes(asString(p.method)) ? p.method : 'POST'
      ) as 'GET' | 'POST' | 'DELETE'
      return requestJson(ctx, path, p.body === undefined ? undefined : asRecord(p.body), {
        method,
        query: asRecord(p.query) as Record<string, string | number | undefined>,
      })
    }
    default:
      throw new ProviderError('invalid_input', `未知的 MiniMax native 操作：${op}`)
  }
}

const REMOTE_IMAGE = /^(https?:\/\/|mm_file:\/\/|data:image\/)/i

/**
 * H3-Image-Context-IR：同步返回增强后的 prompt，不生成图片。可用模型和上下限取自声明
 * （`native: ['image-context-ir']`；参考图数量、素材要求、提示词上限同生成接口）。
 */
export async function imageContextIr(
  ctx: AdapterContext,
  params: Json,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const requested = asString(params.model)
  // 渠道前缀、canonicalId、官方别名都按声明解析
  const declared = requested ? resolveModel(models, requested)?.declaration : undefined
  const resolved = requested
    ? declared?.native?.includes('image-context-ir')
      ? declared
      : undefined
    : selectNativeModel(models, 'image-context-ir')?.declaration
  if (!resolved)
    throw new ProviderError(
      'invalid_input',
      requested ? `${requested} 不支持单独调用 Prompt 增强` : '没有可用的 Prompt 增强模型',
    )
  const limits = resolved.limits ?? {}
  const prompt = asString(params.prompt)
  required(prompt, limits.promptMaxLength ?? 32000, '图片提示词')
  const sources = arr(params.images)
    .map((item) => asString(item))
    .filter(Boolean)
  const maxImages = limits.references?.max ?? 16
  if (sources.length > maxImages)
    throw new ProviderError('invalid_input', `${resolved.title} 最多 ${maxImages} 张参考图`)
  const size = asString(params.size).replace('*', 'x') || undefined
  const explicit = size !== undefined && size !== 'auto'
  if (explicit && (params.aspect_ratio !== undefined || params.area !== undefined))
    throw new ProviderError('invalid_input', 'size 为宽x高时不能再传 aspect_ratio 或 area')
  const area = asString(params.area) || undefined
  if (area && limits.resolutions && !limits.resolutions.includes(area))
    throw new ProviderError(
      'invalid_input',
      `${resolved.title} 的 area 只支持 ${limits.resolutions.join(' / ')}`,
    )
  const files = withFiles(ctx).files
  const requirement = limits.media?.image
  let bytes = 0
  const images: Json[] = []
  for (const source of sources) {
    if (REMOTE_IMAGE.test(source)) {
      images.push({ image_url: source })
      continue
    }
    if (!files) throw new ProviderError('invalid_input', '读取本地参考图需要素材源')
    const loaded = await files.read({ assetId: source, kind: 'image' })
    const mime = (loaded.mime ?? '').toLowerCase()
    if (requirement?.mime && !requirement.mime.includes(mime))
      throw new ProviderError('invalid_input', `${resolved.title} 不支持 ${mime} 格式的参考图`)
    if (
      !loaded.data.length ||
      (requirement?.maxMB && loaded.data.length > requirement.maxMB * 1024 * 1024)
    )
      throw new ProviderError('invalid_input', `参考图为空或超过 ${requirement?.maxMB} MB`)
    const encoded = toBase64(loaded.data)
    // 官方：请求体合计 ≤ 64 MiB（base64 后），与生成接口的编码后总量检查一致
    bytes += encoded.length
    if (bytes > 63 * 1024 * 1024)
      throw new ProviderError(
        'invalid_input',
        '参考图编码后超过请求上限，请改用公网 URL 或 mm_file://',
      )
    images.push({ image_url: `data:${mime};base64,${encoded}` })
  }
  const data = await requestJson(ctx, IMAGE_CONTEXT_IR_PATH, {
    model: resolved.channels[0]!.id,
    prompt,
    ...(images.length ? { images } : {}),
    size,
    aspect_ratio: explicit ? undefined : params.aspect_ratio,
    area: explicit ? undefined : area,
  })
  if (typeof data.revised_prompt !== 'string' || !data.revised_prompt)
    throw new ProviderError('unknown', 'MiniMax 响应缺少增强后的 prompt', { retryable: false })
  return {
    revised_prompt: data.revised_prompt,
    ...(typeof data.aspect_ratio === 'string' ? { aspect_ratio: data.aspect_ratio } : {}),
    ...(data.usage ? { usage: data.usage } : {}),
    ...(data.request_id ? { request_id: data.request_id } : {}),
  }
}

/** Helper exposed for tests: base64 of an asset (no Node-only APIs). */
export async function assetDataUrl(ctx: AdapterContext, assetId: string): Promise<string> {
  if (!ctx.assets) throw new ProviderError('invalid_input', 'An assets source is required')
  const loaded = await ctx.assets.load(assetId)
  return `data:${loaded.mime};base64,${toBase64(loaded.data)}`
}
