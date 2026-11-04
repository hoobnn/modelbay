/**
 * Bailian-only native operations and their parameter schemas.
 *
 * Native capabilities are platform-specific, so the adapter declares each op's JSON
 * Schema itself (see `nativeOperationSchemas`) instead of deriving it from a declaration.
 */
import { ProviderError } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { asJson, arr, requestJson, type Json } from './http'
import { ASR_MODEL, buildAsrRequest, parseAsrResponse, resolveAudio } from './asr'
import {
  buildCloneRequest,
  buildDesignRequest,
  buildGetVoiceRequest,
  buildListVoicesRequest,
  cloneAudio,
  parseVoiceResult,
  CLONE_TARGETS,
  DESIGN_TARGETS,
} from './voice'
import { checkTts, parseTtsResponse, resolveTtsModel, ttsRequest, TTS_CHUNK } from './tts'

export const RERANK_PATH = '/api/v1/services/rerank/text-rerank/text-rerank'
export const EMBED_TEXT_PATH = '/compatible-mode/v1/embeddings'
export const EMBED_MULTIMODAL_PATH =
  '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
export const PORTRAIT_PATH = '/api/v1/services/aigc/image2video/video-synthesis'

export const BAILIAN_NATIVE_OPERATIONS = [
  'rerank',
  'text-embed',
  'qwen-audio-tts',
  'asr',
  'voice-clone',
  'voice-design',
  'voice-list',
  'voice-query',
  'digital-human-lipsync',
  'raw-request',
] as const

/** Parameter JSON Schemas, declared by the adapter (used by the MCP generator). */
export const nativeOperationSchemas: Record<string, Record<string, unknown>> = {
  rerank: {
    type: 'object',
    required: ['query', 'documents'],
    properties: {
      model: { type: 'string', default: 'qwen3-rerank' },
      query: { type: 'string' },
      documents: { type: 'array', items: { type: 'string' } },
      top_n: { type: 'integer' },
      return_documents: { type: 'boolean' },
    },
  },
  'text-embed': {
    type: 'object',
    properties: {
      model: { type: 'string', default: 'text-embedding-v4' },
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
      model: { type: 'string' },
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
      model: { type: 'string', default: ASR_MODEL },
      context: { type: 'string' },
      language: { type: 'string' },
      itn: { type: 'boolean' },
      parameters: { type: 'object' },
    },
  },
  'voice-clone': {
    type: 'object',
    required: ['audio'],
    properties: {
      audio: { type: 'string' },
      target_model: { type: 'string', enum: CLONE_TARGETS },
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
      target_model: { type: 'string', enum: DESIGN_TARGETS },
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

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function asRecord(value: unknown): Json {
  return asJson(value)
}
function asStringArray(value: unknown): string[] {
  return arr(value).filter((item): item is string => typeof item === 'string')
}

/** Text rerank: native `/services/rerank/text-rerank/text-rerank`. */
export async function rerank(params: Json, ctx: AdapterContext): Promise<Json> {
  const query = asString(params.query)
  const documents = asStringArray(params.documents)
  const topN = params.top_n
  if (
    !query.trim() ||
    !documents.length ||
    (topN !== undefined &&
      (!Number.isInteger(topN) || (topN as number) < 1 || (topN as number) > documents.length))
  )
    throw new ProviderError(
      'invalid_input',
      'query and non-empty documents are required; top_n within 1..len(documents)',
    )
  const parameters: Json = { return_documents: params.return_documents === true }
  if (topN !== undefined) parameters.top_n = topN
  const body: Json = {
    model: asString(params.model, 'qwen3-rerank'),
    input: { query, documents },
    parameters,
  }
  const data = await requestJson(ctx, RERANK_PATH, body)
  const results = arr(data.results).length ? arr(data.results) : arr(asJson(data.output).results)
  return { model: body.model, results, usage: data.usage, request_id: data.request_id }
}

/** Text or multimodal embedding; exactly one of `texts` / `contents` is required. */
export async function textEmbed(params: Json, ctx: AdapterContext): Promise<Json> {
  const texts = asStringArray(params.texts)
  const contents = arr(params.contents).map(asJson)
  if (texts.length === contents.length)
    throw new ProviderError('invalid_input', 'Provide exactly one of texts or contents')
  const options = { ...asRecord(params.parameters) }
  if (params.dimensions !== undefined) {
    if (contents.length) options.dimension = params.dimensions
    else options.dimensions = params.dimensions
  }
  const model = asString(
    params.model,
    contents.length ? 'multimodal-embedding-v1' : 'text-embedding-v4',
  )
  let body: Json
  let path: string
  if (contents.length) {
    if (Object.keys(options).some((key) => ['model', 'input'].includes(key)))
      throw new ProviderError('invalid_input', 'parameters must not override model/input')
    body = { model, input: { contents }, parameters: options }
    path = EMBED_MULTIMODAL_PATH
  } else {
    if (Object.keys(options).some((key) => ['model', 'input'].includes(key)))
      throw new ProviderError('invalid_input', 'parameters must not override model/input')
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
export async function digitalHumanLipsync(params: Json, ctx: AdapterContext): Promise<Json> {
  const imageUrl = asString(params.image_url)
  const audioUrl = asString(params.audio_url)
  const resolution = asString(params.resolution, '720P')
  if (!imageUrl || !audioUrl || !['480P', '720P'].includes(resolution))
    throw new ProviderError(
      'invalid_input',
      'image_url/audio_url and 480P|720P resolution are required',
    )
  if ([imageUrl, audioUrl].some((src) => src.startsWith('data:')))
    throw new ProviderError('invalid_input', 'Portrait inputs must be public URLs, not data URIs')
  const body: Json = {
    model: 'wan2.2-s2v',
    input: { image_url: imageUrl, audio_url: audioUrl },
    parameters: { resolution, ...asRecord(params.parameters) },
  }
  const data = await requestJson(ctx, PORTRAIT_PATH, body, { asyncTask: true, oss: true })
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', 'Portrait submission is missing task_id')
  return { taskId, requestId: data.request_id }
}

/** Dispatch a native operation; unknown ops are rejected with a clear ProviderError. */
export async function runBailianNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
): Promise<unknown> {
  const p = asJson(params)
  switch (op) {
    case 'rerank':
      return rerank(p, ctx)
    case 'text-embed':
      return textEmbed(p, ctx)
    case 'qwen-audio-tts': {
      const model = resolveTtsModel(asString(p.model) || undefined, asString(p.voice) || undefined)
      const text = asString(p.text)
      const opts = {
        text,
        voice: asString(p.voice) || undefined,
        instructions: asString(p.instructions) || undefined,
        language: asString(p.language) || undefined,
        parameters: asRecord(p.parameters),
      }
      const problem = checkTts(model, opts, 'url')
      if (problem) throw new ProviderError('invalid_input', problem)
      const { path, body } = ttsRequest(model, opts, text)
      return parseTtsResponse(await requestJson(ctx, path, body))
    }
    case 'asr': {
      const audioData = await resolveAudio(asString(p.audio), ctx)
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
      )
      return parseAsrResponse(await requestJson(ctx, path, body))
    }
    case 'voice-clone': {
      const audio = await cloneAudio(asString(p.audio), ctx)
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
      )
      const result = parseVoiceResult(
        await requestJson(ctx, '/api/v1/services/audio/tts/customization', body),
      )
      if (!result.voiceId)
        throw new ProviderError(
          'unknown',
          'Clone response has no voice ID; check voice-list before retrying',
        )
      return result
    }
    case 'voice-design': {
      const body = buildDesignRequest({
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
      })
      const result = parseVoiceResult(
        await requestJson(ctx, '/api/v1/services/audio/tts/customization', body),
      )
      if (!result.voiceId)
        throw new ProviderError(
          'unknown',
          'Design response has no voice ID; check voice-list before retrying',
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
      return digitalHumanLipsync(p, ctx)
    case 'raw-request': {
      const path = asString(p.path)
      if (!path.startsWith('/'))
        throw new ProviderError('invalid_input', 'raw-request path must start with /')
      const method = (
        ['GET', 'POST', 'DELETE'].includes(asString(p.method)) ? p.method : 'POST'
      ) as 'GET' | 'POST' | 'DELETE'
      const body = p.body === undefined ? undefined : asRecord(p.body)
      return requestJson(ctx, path, body, { method, asyncTask: p.async_task === true })
    }
    default:
      throw new ProviderError('invalid_input', `Unknown Bailian native operation: ${op}`)
  }
}
