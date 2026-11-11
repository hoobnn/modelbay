/**
 * Bailian-only native operations and their parameter schemas.
 *
 * Native capabilities are platform-specific, so the adapter declares each op's JSON
 * Schema itself (see `nativeOperationSchemas`) instead of deriving it from a declaration.
 * 与模型有关的取值（可用的 TTS 模型、复刻/设计的目标模型）从声明派生。
 */
import { ProviderError, selectDefaultModel, selectNativeModel, toModelInfo } from '@modelbay/core'
import type { AdapterContext, AssetRef, ModelDeclaration } from '@modelbay/core'
import { openAiModelList } from '@modelbay/shared'
import { generateAudio, referenceSources } from './audio-generation'
import { asJson, arr, bailianSettings, requestJson, type Json } from './http'
import { optionKeys, optionsProblem } from './options'
import {
  asrModels,
  buildAsrRequest,
  buildFiletransRequest,
  parseAsrResponse,
  resolveAudio,
} from './asr'
import {
  buildCloneRequest,
  buildDesignRequest,
  buildGetVoiceRequest,
  buildListVoicesRequest,
  cloneAudio,
  parseVoiceResult,
  voiceTargets,
} from './voice'
import {
  checkTts,
  defaultVoiceFor,
  parseTtsResponse,
  resolveTtsModel,
  ttsModels,
  ttsRequest,
  TTS_CHUNK,
} from './tts'

export const RERANK_PATH = '/api/v1/services/rerank/text-rerank/text-rerank'
export const EMBED_TEXT_PATH = '/compatible-mode/v1/embeddings'
export const EMBED_MULTIMODAL_PATH =
  '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
export const PORTRAIT_PATH = '/api/v1/services/aigc/image2video/video-synthesis'
export const VIDEO_SYNTHESIS_PATH = '/api/v1/services/aigc/video-generation/video-synthesis'

export const BAILIAN_NATIVE_OPERATIONS = [
  'listModels',
  'rerank',
  'text-embed',
  'qwen-audio-tts',
  'asr',
  'asr-filetrans',
  'audio-generation',
  'voice-clone',
  'voice-design',
  'voice-list',
  'voice-query',
  'digital-human-lipsync',
  'edit-video',
  'raw-request',
] as const

/**
 * Parameter JSON Schemas, declared by the adapter (used by the MCP generator).
 *
 * 与模型有关的部分（可用的 TTS 模型 ID、复刻/设计的目标模型）从声明派生，
 * 改声明就跟着变。
 */
export function nativeOperationSchemas(
  models: readonly ModelDeclaration[],
): Record<string, Record<string, unknown>> {
  const tts = ttsModels(models)
  const targets = voiceTargets(models)
  const asr = asrModels(models)
  const rerankModel = selectNativeModel(models, 'rerank', 'bailian')?.channel.id
  const audioGen = selectNativeModel(models, 'audio-generation', 'bailian')
  const filetrans = selectNativeModel(models, 'asr-filetrans', 'bailian')
  const rerankOptions = Object.assign(
    {},
    ...models
      .filter((item) => item.native?.includes('rerank'))
      .map((item) => (item.optionsSchema?.properties ?? {}) as Record<string, unknown>),
  ) as Record<string, unknown>
  const embedModel = selectDefaultModel(models, 'text.embed', 'bailian')?.channel.id
  return {
    listModels: { type: 'object', properties: {} },
    rerank: {
      type: 'object',
      required: ['query', 'documents'],
      properties: {
        model: { type: 'string', ...(rerankModel ? { default: rerankModel } : {}) },
        query: { anyOf: [{ type: 'string' }, RERANK_ITEM] },
        documents: { type: 'array', items: { anyOf: [{ type: 'string' }, RERANK_ITEM] } },
        top_n: { type: 'integer' },
        return_documents: { type: 'boolean' },
        instruct: { type: 'string' },
        // 模型专属参数（如 qwen3-vl-rerank 的 fps）及其范围来自声明的 optionsSchema
        ...rerankOptions,
      },
    },
    'text-embed': {
      type: 'object',
      properties: {
        model: { type: 'string', ...(embedModel ? { default: embedModel } : {}) },
        texts: { type: 'array', items: { type: 'string' } },
        contents: { type: 'array', items: { type: 'object' } },
        dimensions: { type: 'integer' },
        parameters: { type: 'object' },
      },
    },
    'qwen-audio-tts': {
      type: 'object',
      required: ['text', 'voice'],
      properties: {
        model: { type: 'string', enum: tts.map((item) => item.id) },
        text: { type: 'string', maxLength: TTS_CHUNK },
        voice: { type: 'string' },
        instructions: { type: 'string' },
        language: { type: 'string' },
        parameters: { type: 'object' },
      },
    },
    asr: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: { type: 'string', description: 'Public URL or data URI' },
        model: { type: 'string', ...(asr.default ? { default: asr.default } : {}) },
        context: { type: 'string' },
        language: { type: 'string' },
        itn: { type: 'boolean' },
        parameters: { type: 'object' },
      },
    },
    'asr-filetrans': {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          description: 'Public URL or oss:// address (Data URI not accepted)',
        },
        model: {
          type: 'string',
          ...(asr.filetrans.length ? { enum: asr.filetrans, default: asr.filetrans[0] } : {}),
        },
        language: { type: 'string' },
        // diarization / speaker_count 的取值范围来自声明的 optionsSchema
        ...((filetrans?.declaration.optionsSchema?.properties ?? {}) as Record<string, unknown>),
        parameters: { type: 'object' },
      },
    },
    'audio-generation': {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description:
            'Natural-language description of the audio; cite references as @voice1–@voice3',
          ...(audioGen?.declaration.limits?.promptMaxLength
            ? { maxLength: audioGen.declaration.limits.promptMaxLength }
            : {}),
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reference voices: public URL or data URI',
          ...(audioGen?.declaration.limits?.references
            ? { maxItems: audioGen.declaration.limits.references.max }
            : {}),
        },
        model: { type: 'string', ...(audioGen ? { default: audioGen.channel.id } : {}) },
        ...((audioGen?.declaration.optionsSchema?.properties ?? {}) as Record<string, unknown>),
        parameters: { type: 'object' },
      },
    },
    'voice-clone': {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: { type: 'string' },
        target_model: { type: 'string', enum: targets.clone },
        prefix: { type: 'string' },
        language: { type: 'string' },
        enable_preprocess: { type: 'boolean' },
        max_prompt_audio_length: { type: 'number' },
      },
    },
    'voice-design': {
      type: 'object',
      required: ['voice_prompt', 'preview_text'],
      properties: {
        voice_prompt: { type: 'string' },
        preview_text: { type: 'string' },
        target_model: { type: 'string', enum: targets.design },
        prefix: { type: 'string' },
        language: { type: 'string', enum: ['zh', 'en'] },
        sample_rate: { type: 'integer', enum: [16000, 24000, 48000] },
        response_format: { type: 'string', enum: ['pcm', 'wav', 'mp3'] },
      },
    },
    'voice-list': {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['enrollment', 'cosyvoice', 'clone', 'design'] },
        page_index: { type: 'integer' },
        page_size: { type: 'integer' },
        prefix: { type: 'string' },
      },
    },
    'voice-query': {
      type: 'object',
      required: ['voice_id'],
      properties: { voice_id: { type: 'string' }, kind: { type: 'string' } },
    },
    'digital-human-lipsync': {
      type: 'object',
      required: ['image_url', 'audio_url'],
      properties: {
        image_url: { type: 'string' },
        audio_url: { type: 'string' },
        resolution: { type: 'string', enum: ['480P', '720P'] },
        parameters: { type: 'object' },
      },
    },
    'edit-video': {
      type: 'object',
      required: ['video', 'prompt'],
      properties: {
        video: { type: 'string' },
        prompt: { type: 'string' },
        reference_images: { type: 'array', items: { type: 'string' } },
        resolution: { type: 'string' },
        model: { type: 'string' },
        watermark: { type: 'boolean' },
        audio_setting: { type: 'string' },
        seed: { type: 'integer' },
        parameters: { type: 'object' },
      },
    },
    'raw-request': {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        method: { type: 'string', enum: ['GET', 'POST', 'DELETE'] },
        body: { type: 'object' },
        async_task: { type: 'boolean' },
      },
    },
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
/** 音频来源：字符串（URL / Data URI）或宿主素材引用（MCP 把本地路径换成它）。 */
function audioSource(value: unknown): string | AssetRef {
  const ref = asJson(value)
  if (typeof ref.assetId === 'string' && ref.assetId)
    return {
      assetId: ref.assetId,
      kind: 'audio',
      ...(typeof ref.mime === 'string' ? { mime: ref.mime } : {}),
    }
  return asString(value)
}
function asRecord(value: unknown): Json {
  return asJson(value)
}
function asStringArray(value: unknown): string[] {
  return arr(value).filter((item): item is string => typeof item === 'string')
}

/** 多模态重排序的一项：恰好一个 text / image / video 键（官方格式 `{"模态类型": "输入内容"}`）。 */
const RERANK_ITEM = {
  type: 'object',
  minProperties: 1,
  maxProperties: 1,
  properties: { text: { type: 'string' }, image: { type: 'string' }, video: { type: 'string' } },
  additionalProperties: false,
}

/** 字符串原样；对象只保留一个非空的 text / image / video（query 不收 video）。不合法返回 undefined。 */
function rerankItem(value: unknown, allowVideo: boolean): string | Json | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined
  const item = asJson(value)
  const keys = Object.keys(item)
  const key = keys[0]
  if (keys.length !== 1 || !key) return undefined
  if (!['text', 'image', ...(allowVideo ? ['video'] : [])].includes(key)) return undefined
  const content = item[key]
  if (typeof content !== 'string' || !content.trim()) return undefined
  if (key === 'video' && !PUBLIC_URL.test(content)) return undefined
  return { [key]: content }
}

/**
 * 重排序：native `/services/rerank/text-rerank/text-rerank`。
 * qwen3-vl-rerank 的 query 可以是文本或 `{text|image}`，documents 可以混合文本与 `{text|image|video}`；
 * 视频只收公网 URL，图片收 URL 或 Data URI。来源：https://help.aliyun.com/zh/model-studio/text-rerank-api（2026-11-11 核对）
 */
export async function rerank(
  params: Json,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const query = rerankItem(params.query, false)
  const documents = arr(params.documents).map((item) => rerankItem(item, true))
  const topN = params.top_n
  if (documents.some((item) => item === undefined))
    throw new ProviderError(
      'invalid_input',
      'documents 每项须为非空文本，或只含一个 text / image / video 键的对象（视频须为公网 URL）',
    )
  if (
    query === undefined ||
    !documents.length ||
    (topN !== undefined &&
      (!Number.isInteger(topN) || (topN as number) < 1 || (topN as number) > documents.length))
  )
    throw new ProviderError(
      'invalid_input',
      '须提供 query 和非空的 documents，且 top_n 在 1 到 documents 数量之间',
    )
  // 2026-11-11 实测：documents 里字符串与对象混用会被拒（list[str] 与 list[item] 二选一），
  // 所以只要有对象就把字符串统一包成 {text}。
  const multimodal = documents.some((item) => typeof item !== 'string')
  const docs = multimodal
    ? documents.map((item) => (typeof item === 'string' ? { text: item } : item))
    : documents
  const model =
    asString(params.model) || selectNativeModel(models, 'rerank', 'bailian')?.channel.id || ''
  const declaration = models.find(
    (item) =>
      item.native?.includes('rerank') &&
      item.channels.some((ref) => ref.channel === 'bailian' && ref.id === model),
  )
  // 模型专属参数按声明的 optionsSchema 收与校验（如 fps 只有 qwen3-vl-rerank 有）
  const names = optionKeys(declaration?.optionsSchema)
  const options = Object.fromEntries(
    names.filter((key) => params[key] !== undefined).map((key) => [key, params[key]]),
  )
  if (params.fps !== undefined && !names.includes('fps'))
    throw new ProviderError('invalid_input', `${model} 不支持 fps`)
  if (optionsProblem(declaration?.optionsSchema, options))
    throw new ProviderError('invalid_input', '重排序参数无效')
  const parameters: Json = { return_documents: params.return_documents === true, ...options }
  if (topN !== undefined) parameters.top_n = topN
  if (typeof params.instruct === 'string' && params.instruct) parameters.instruct = params.instruct
  const body: Json = {
    model,
    input: { query, documents: docs },
    parameters,
  }
  const data = await requestJson(ctx, RERANK_PATH, body)
  const results = arr(data.results).length ? arr(data.results) : arr(asJson(data.output).results)
  return { model: body.model, results, usage: data.usage, request_id: data.request_id }
}

/** Text or multimodal embedding; exactly one of `texts` / `contents` is required. */
export async function textEmbed(
  params: Json,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const texts = asStringArray(params.texts)
  const contents = arr(params.contents).map(asJson)
  if (texts.length === contents.length)
    throw new ProviderError('invalid_input', 'texts 与 contents 须二选一')
  const options = { ...asRecord(params.parameters) }
  if (params.dimensions !== undefined) {
    if (contents.length) options.dimension = params.dimensions
    else options.dimensions = params.dimensions
  }
  // 多模态向量化要显式指定模型（默认的文本向量模型不支持图文输入）。
  const model =
    asString(params.model) ||
    (contents.length ? '' : (selectDefaultModel(models, 'text.embed', 'bailian')?.channel.id ?? ''))
  if (!model) throw new ProviderError('invalid_input', '多模态向量化请显式指定 model')
  let body: Json
  let path: string
  if (contents.length) {
    if (Object.keys(options).some((key) => ['model', 'input'].includes(key)))
      throw new ProviderError('invalid_input', 'parameters 不能覆盖 model / input')
    body = { model, input: { contents }, parameters: options }
    path = EMBED_MULTIMODAL_PATH
  } else {
    if (Object.keys(options).some((key) => ['model', 'input'].includes(key)))
      throw new ProviderError('invalid_input', 'parameters 不能覆盖 model / input')
    body = { model, input: texts, encoding_format: 'float', ...options }
    path = EMBED_TEXT_PATH
  }
  const data = await requestJson(ctx, path, body)
  return {
    model,
    data: data.data ?? asJson(data.output).embeddings ?? [],
    usage: data.usage,
    request_id: data.request_id,
  }
}

/** Digital-human portrait animation (wan2.2-s2v), returns an async task id. */
export async function digitalHumanLipsync(
  params: Json,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const imageUrl = asString(params.image_url)
  const audioUrl = asString(params.audio_url)
  const resolution = asString(params.resolution, '720P')
  if (!imageUrl || !audioUrl || !['480P', '720P'].includes(resolution))
    throw new ProviderError('invalid_input', '须提供 image_url、audio_url 以及 480P 或 720P 分辨率')
  if ([imageUrl, audioUrl].some((src) => src.startsWith('data:')))
    throw new ProviderError('invalid_input', '数字人输入须为公网 URL，不能是 Data URI')
  const body: Json = {
    model:
      asString(params.model) ||
      selectNativeModel(models, 'digital-human-lipsync', 'bailian')?.channel.id ||
      '',
    input: { image_url: imageUrl, audio_url: audioUrl },
    parameters: { resolution, ...asRecord(params.parameters) },
  }
  const data = await requestJson(ctx, PORTRAIT_PATH, body, { asyncTask: true, oss: true })
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', '数字人任务缺少 task_id；请勿重新提交任务')
  return { job_id: taskId, task_id: taskId, request_id: data.request_id }
}

const PUBLIC_URL = /^https?:\/\//i
const IMAGE_DATA_URI = /^data:image\/(?:jpeg|png|webp);base64,/i

/**
 * HappyHorse 视频指令编辑（happyhorse-1.0-video-edit），返回异步任务 ID。
 * 来源：https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference（2026-11-06 核对）：
 * input.media 恰好 1 个 video 加 0–5 个 reference_image；parameters 为 resolution / watermark /
 * audio_setting / seed。取值范围与默认值读声明，视频只收公网 URL。
 */
export async function editVideo(
  params: Json,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const requested = asString(params.model)
  const declaration = requested
    ? models.find(
        (item) =>
          item.native?.includes('edit-video') &&
          item.channels.some(
            (channel) => channel.channel === 'bailian' && channel.id === requested,
          ),
      )
    : selectNativeModel(models, 'edit-video', 'bailian')?.declaration
  const channel = declaration?.channels.find((item) => item.channel === 'bailian')
  if (!declaration || !channel)
    throw new ProviderError('invalid_input', `${requested || 'edit-video'} 不是视频编辑模型`)
  const spec = toModelInfo(declaration, channel)
  const limits = spec.limits ?? {}

  const video = asString(params.video)
  const prompt = asString(params.prompt)
  if (!PUBLIC_URL.test(video))
    throw new ProviderError(
      'invalid_input',
      '视频编辑须提供公网 URL 的 video，不接受本地文件或 Data URI',
    )
  if (!prompt.trim()) throw new ProviderError('invalid_input', '视频编辑须提供 prompt')
  const images = asStringArray(params.reference_images)
  const maxImages = limits.references?.max
  if (maxImages !== undefined && images.length > maxImages)
    throw new ProviderError('invalid_input', `参考图最多 ${maxImages} 张`)
  if (images.some((src) => !PUBLIC_URL.test(src) && !IMAGE_DATA_URI.test(src)))
    throw new ProviderError(
      'invalid_input',
      '参考图须为公网 URL 或 jpeg / png / webp 的 Base64 Data URI',
    )
  const resolution = asString(params.resolution) || limits.defaultResolution
  if (limits.resolutions && (!resolution || !limits.resolutions.includes(resolution)))
    throw new ProviderError('invalid_input', `分辨率须为 ${limits.resolutions.join(' 或 ')}`)

  const names = optionKeys(spec.optionsSchema)
  const options = Object.fromEntries(
    Object.entries(params).filter(([key, value]) => names.includes(key) && value !== undefined),
  )
  if (optionsProblem(spec.optionsSchema, options))
    throw new ProviderError('invalid_input', '视频编辑专属参数无效')
  const extra = asRecord(params.parameters)
  const body: Json = {
    model: channel.id,
    input: {
      prompt,
      media: [
        { type: 'video', url: video },
        ...images.map((url) => ({ type: 'reference_image', url })),
      ],
    },
    parameters: { ...extra, ...(resolution ? { resolution } : {}), ...options },
  }
  const data = await requestJson(ctx, VIDEO_SYNTHESIS_PATH, body, { asyncTask: true })
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', '视频编辑任务缺少 task_id；请勿重新提交任务')
  return { job_id: taskId, task_id: taskId, request_id: data.request_id }
}

/** 上传素材引用、换成 oss:// 地址（由适配器注入，避免 native 反向依赖 adapter）。 */
export type UploadAsset = (ctx: AdapterContext, ref: AssetRef, model: string) => Promise<string>

/** 录音文件转写：提交异步任务，返回任务 ID；结果由 poll 读 transcription_url。 */
export async function asrFiletrans(
  params: Json,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
  upload?: UploadAsset,
): Promise<Json> {
  const available = asrModels(models)
  const model = asString(params.model) || available.filetrans[0] || ''
  const source = audioSource(params.audio)
  const speakerCount = params.speaker_count
  const declaration = models.find(
    (item) =>
      item.native?.includes('asr-filetrans') &&
      item.channels.some((ref) => ref.channel === 'bailian' && ref.id === model),
  )
  const options = Object.fromEntries(
    Object.entries({ diarization: params.diarization, speaker_count: speakerCount }).filter(
      ([, value]) => value !== undefined,
    ),
  )
  if (!declaration)
    throw new ProviderError(
      'invalid_input',
      available.filetrans.length
        ? `文件转写只支持 ${available.filetrans.join('、')}`
        : '当前没有声明文件转写模型',
    )
  if (optionsProblem(declaration.optionsSchema, options))
    throw new ProviderError('invalid_input', '文件转写参数无效（diarization / speaker_count）')
  let fileUrl: string
  if (typeof source === 'string') {
    if (source.startsWith('data:'))
      throw new ProviderError('invalid_input', '文件转写不接受 Data URI，请传公网 URL 或本地文件')
    fileUrl = source
  } else {
    if (!upload) throw new ProviderError('invalid_input', '当前宿主不支持上传本地音频')
    fileUrl = await upload(ctx, source, model)
  }
  const { path, body } = buildFiletransRequest(
    {
      fileUrl,
      model: model || undefined,
      language: asString(params.language) || undefined,
      diarization: typeof params.diarization === 'boolean' ? params.diarization : undefined,
      speakerCount: typeof speakerCount === 'number' ? speakerCount : undefined,
      parameters: asRecord(params.parameters),
    },
    available,
  )
  const data = await requestJson(ctx, path, body, {
    asyncTask: true,
    oss: fileUrl.startsWith('oss://'),
  })
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', '文件转写任务缺少 task_id；请勿重新提交任务')
  return { job_id: taskId, task_id: taskId, request_id: data.request_id }
}

/**
 * 远端模型列表：DashScope 兼容模式 `/compatible-mode/v1/models`。
 * 业务空间域名的列表接口未经官方确证，暂不支持。
 */
export async function listModels(ctx: AdapterContext) {
  if (bailianSettings(ctx).workspaceId)
    throw new ProviderError(
      'invalid_input',
      '业务空间模式暂不支持拉取远端模型列表；可清空业务空间 ID 后使用 DashScope 兼容端点拉取',
    )
  return openAiModelList(await requestJson(ctx, '/compatible-mode/v1/models')).map((model) => ({
    ...model,
    features: ['structured' as const],
  }))
}

/** Dispatch a native operation; unknown ops are rejected with a clear ProviderError. */
export async function runBailianNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
  upload?: UploadAsset,
): Promise<unknown> {
  const p = asJson(params)
  const tts = ttsModels(models)
  const targets = voiceTargets(models)
  switch (op) {
    case 'listModels':
      return listModels(ctx)
    case 'rerank':
      return rerank(p, ctx, models)
    case 'text-embed':
      return textEmbed(p, ctx, models)
    case 'qwen-audio-tts': {
      const model = resolveTtsModel(tts, {
        model: asString(p.model) || undefined,
        voice: asString(p.voice) || undefined,
        language: asString(p.language) || undefined,
        parameters: asRecord(p.parameters),
      })
      const text = asString(p.text)
      const voice =
        asString(p.voice) || defaultVoiceFor(tts, model, Boolean(asString(p.model))) || undefined
      const opts = {
        text,
        voice,
        instructions: asString(p.instructions) || undefined,
        language: asString(p.language) || undefined,
        parameters: asRecord(p.parameters),
      }
      const problem = checkTts(model, opts, tts, 'url')
      if (problem) throw new ProviderError('invalid_input', problem)
      const { path, body } = ttsRequest(model, opts, text, tts)
      return parseTtsResponse(await requestJson(ctx, path, body))
    }
    case 'asr': {
      const audioData = await resolveAudio(audioSource(p.audio), ctx)
      const { path, body } = buildAsrRequest(
        {
          audio: audioData,
          model: asString(p.model) || undefined,
          context: asString(p.context) || undefined,
          language: asString(p.language) || undefined,
          itn: p.itn === undefined ? undefined : p.itn === true,
          parameters: asRecord(p.parameters),
        },
        audioData,
        asrModels(models),
      )
      return parseAsrResponse(await requestJson(ctx, path, body))
    }
    case 'asr-filetrans':
      return asrFiletrans(p, ctx, models, upload)
    case 'audio-generation': {
      const reserved = ['prompt', 'references', 'model', 'parameters']
      return generateAudio(
        {
          prompt: asString(p.prompt),
          references: referenceSources(p.references),
          model: asString(p.model) || undefined,
          options: Object.fromEntries(
            Object.entries(p).filter(
              ([key, value]) => !reserved.includes(key) && value !== undefined,
            ),
          ),
          parameters: asRecord(p.parameters),
        },
        ctx,
        models,
      )
    }
    case 'voice-clone': {
      const audio = await cloneAudio(audioSource(p.audio), ctx)
      const body = buildCloneRequest(
        {
          audio,
          targetModel: asString(p.target_model) || undefined,
          prefix: asString(p.prefix) || undefined,
          language: asString(p.language) || undefined,
          enablePreprocess:
            p.enable_preprocess === undefined ? undefined : p.enable_preprocess === true,
          maxPromptAudioLength:
            typeof p.max_prompt_audio_length === 'number' ? p.max_prompt_audio_length : undefined,
        },
        audio,
        targets,
      )
      const result = parseVoiceResult(
        await requestJson(ctx, '/api/v1/services/audio/tts/customization', body),
      )
      if (!result.voiceId)
        throw new ProviderError(
          'unknown',
          '复刻结果缺少音色 ID；重试前请先查看音色列表，避免重复复刻',
        )
      return result
    }
    case 'voice-design': {
      const body = buildDesignRequest(
        {
          voicePrompt: asString(p.voice_prompt),
          previewText: asString(p.preview_text),
          targetModel: asString(p.target_model),
          prefix: asString(p.prefix) || undefined,
          language: (asString(p.language) || undefined) as 'zh' | 'en' | undefined,
          sampleRate: [16000, 24000, 48000].includes(p.sample_rate as number)
            ? (p.sample_rate as 16000 | 24000 | 48000)
            : undefined,
          responseFormat: ['pcm', 'wav', 'mp3'].includes(asString(p.response_format))
            ? (p.response_format as 'pcm' | 'wav' | 'mp3')
            : undefined,
        },
        targets,
      )
      const result = parseVoiceResult(
        await requestJson(ctx, '/api/v1/services/audio/tts/customization', body),
      )
      if (!result.voiceId)
        throw new ProviderError(
          'unknown',
          '设计结果缺少音色 ID；重试前请先查看音色列表，避免重复创建',
        )
      return result
    }
    case 'voice-list': {
      const data = await requestJson(
        ctx,
        '/api/v1/services/audio/tts/customization',
        buildListVoicesRequest({
          kind: (asString(p.kind) || undefined) as
            | 'enrollment'
            | 'cosyvoice'
            | 'clone'
            | 'design'
            | undefined,
          pageIndex: typeof p.page_index === 'number' ? p.page_index : undefined,
          pageSize: typeof p.page_size === 'number' ? p.page_size : undefined,
          prefix: asString(p.prefix) || undefined,
        }),
      )
      const output = asJson(data.output)
      return { voices: arr(output.voice_list).map(asJson), output, requestId: data.request_id }
    }
    case 'voice-query': {
      const voiceId = asString(p.voice_id)
      const data = await requestJson(
        ctx,
        '/api/v1/services/audio/tts/customization',
        buildGetVoiceRequest(voiceId, (asString(p.kind) || 'enrollment') as 'enrollment'),
      )
      return { ...parseVoiceResult(data), voiceId }
    }
    case 'digital-human-lipsync':
      return digitalHumanLipsync(p, ctx, models)
    case 'edit-video':
      return editVideo(p, ctx, models)
    case 'raw-request': {
      const path = asString(p.path)
      if (!path.startsWith('/'))
        throw new ProviderError('invalid_input', 'raw-request 的 path 必须以 / 开头')
      const method = (
        ['GET', 'POST', 'DELETE'].includes(asString(p.method)) ? p.method : 'POST'
      ) as 'GET' | 'POST' | 'DELETE'
      const body = p.body === undefined ? undefined : asRecord(p.body)
      return requestJson(ctx, path, body, { method, asyncTask: p.async_task === true })
    }
    default:
      throw new ProviderError('invalid_input', `百炼不支持的原生操作：${op}`)
  }
}
