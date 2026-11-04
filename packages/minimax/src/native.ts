/**
 * MiniMax-only native operations and their parameter schemas (declared by the adapter).
 */
import { ProviderError, toBase64 } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'

export const CONTEXT_IR_PATH = '/v2/h3_context_ir'
export const RERENDER_PATH = '/v2/video_regeneration'
export const UPLOAD_PATH = '/v1/files/upload'
export const VOICE_CLONE_PATH = '/v1/voice_clone'
export const VOICE_DESIGN_PATH = '/v1/voice_design'
export const QUERY_PATH = '/v2/query/video_generation'

export const MINIMAX_NATIVE_OPERATIONS = [
  'context-ir',
  'video-2k-rerender',
  'voice-clone',
  'voice-design',
  'upload-file',
  'list-video-tasks',
  'raw-request',
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
      text: { type: 'string' },
      noise_reduction: { type: 'boolean' },
      volume_normalization: { type: 'boolean' },
    },
  },
  'voice-design': {
    type: 'object',
    required: ['voice_id', 'prompt', 'preview_text'],
    properties: {
      voice_id: { type: 'string' },
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
    },
  },
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
  const body: Json = { model: 'MiniMax-H3', ...options }
  if (sourceTaskId) body.source_task_id = sourceTaskId
  else {
    body.content = content
    body.resolution = '2K'
  }
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
  return { taskId: String(taskId), requestId: data.request_id }
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
  if (fileId === undefined || (typeof fileId === 'number' && !Number.isSafeInteger(fileId)))
    throw new ProviderError('unknown', 'MiniMax upload returned no usable file_id')
  return { fileId: String(fileId), data }
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
export async function voiceClone(ctx: AdapterContext, params: Json): Promise<Json> {
  const voiceId = asString(params.voice_id)
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId))
    throw new ProviderError('invalid_input', 'Invalid MiniMax voice_id')
  const audio = params.audio
  let fileId: string
  if (typeof audio === 'string' && /^https?:\/\//.test(audio)) {
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
    ...(asString(params.text) ? { text: asString(params.text), model: 'speech-2.8-hd' } : {}),
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
  if (
    !voiceId ||
    !prompt.trim() ||
    prompt.length > 2000 ||
    !previewText.trim() ||
    previewText.length > 500
  )
    throw new ProviderError(
      'invalid_input',
      'voice_id, prompt (<=2000) and preview_text (<=500) are required',
    )
  const data = await requestJson(ctx, VOICE_DESIGN_PATH, {
    voice_id: voiceId,
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
    },
  })
  return data
}

/** Dispatch a native operation. */
export async function runMinimaxNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
): Promise<unknown> {
  const p = asJson(params)
  switch (op) {
    case 'context-ir':
      return submitNativeTask(ctx, 'context-ir', p)
    case 'video-2k-rerender':
      return submitNativeTask(ctx, 'video-2k-rerender', p)
    case 'voice-clone':
      return voiceClone(ctx, p)
    case 'voice-design':
      return voiceDesign(ctx, p)
    case 'upload-file':
      return uploadFile(ctx, p)
    case 'list-video-tasks':
      return listVideoTasks(ctx, p)
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
      throw new ProviderError('invalid_input', `Unknown MiniMax native operation: ${op}`)
  }
}

/** Helper exposed for tests: base64 of an asset (no Node-only APIs). */
export async function assetDataUrl(ctx: AdapterContext, assetId: string): Promise<string> {
  if (!ctx.assets) throw new ProviderError('invalid_input', 'An assets source is required')
  const loaded = await ctx.assets.load(assetId)
  return `data:${loaded.mime};base64,${toBase64(loaded.data)}`
}
