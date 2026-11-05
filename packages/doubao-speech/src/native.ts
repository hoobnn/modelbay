/**
 * Doubao Speech native (single-platform) operations and their parameter schemas.
 */
import { ProviderError, toBase64 } from '@modelbay/core'
import type { AdapterContext } from '@modelbay/core'
import { asJson, arr, postJson, postText, type Json } from './http'
import { consoleAction } from './console'
import {
  interpretationStartRequest,
  INTERPRETATION_CHUNK_BYTES,
  INTERPRETATION_ENDPOINT,
  INTERPRETATION_EVENTS,
  INTERPRETATION_RESOURCE_ID,
} from './interpretation'

export const PODCAST_PATH = '/api/v3/podcast/sse'
export const TRANSLATION_PATH = '/api/v3/machine_translation/matx_translate'
export const MINUTES_SUBMIT_PATH = '/api/v3/auc/lark/submit'
export const MINUTES_QUERY_PATH = '/api/v3/auc/lark/query'
export const WORD_TABLE_PATH = '/api/proxy/invoke'
export const VOICE_CLONE_PATH = '/api/v3/tts/voice_clone'
export const VOICE_DESIGN_PATH = '/api/v3/tts/voice_design'
export const GET_VOICE_PATH = '/api/v3/tts/get_voice'

export {
  INTERPRETATION_ENDPOINT,
  INTERPRETATION_RESOURCE_ID,
  INTERPRETATION_CHUNK_BYTES,
  INTERPRETATION_EVENTS,
} from './interpretation'

export const DOUBAO_NATIVE_OPERATIONS = [
  'podcast',
  'simultaneous-interpretation',
  'translation',
  'meeting-notes',
  'hotword-table',
  'console-management',
  'voice-clone',
  'voice-design',
  'voice-query',
  'raw-request',
] as const

export const nativeOperationSchemas: Record<string, Record<string, unknown>> = {
  podcast: {
    type: 'object',
    properties: {
      action: { type: 'integer', enum: [0, 3, 4], default: 0 },
      input_text: { type: 'string' },
      input_info: { type: 'object' },
      prompt_text: { type: 'string' },
      nlp_texts: { type: 'array', items: { type: 'object' } },
      speaker_info: { type: 'object' },
      audio_config: { type: 'object' },
      retry_info: { type: 'object' },
    },
  },
  'simultaneous-interpretation': {
    type: 'object',
    required: ['source_language', 'target_language'],
    properties: {
      mode: { type: 'string', enum: ['s2t', 's2s'], default: 's2t' },
      source_language: { type: 'string' },
      target_language: { type: 'string' },
      request: { type: 'object' },
    },
  },
  translation: {
    type: 'object',
    required: ['text_list', 'target_language'],
    properties: {
      text_list: { type: 'array', items: { type: 'string' } },
      target_language: { type: 'string' },
      source_language: { type: 'string' },
      corpus: { type: 'object' },
      request: { type: 'object' },
    },
  },
  'meeting-notes': {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['submit', 'query'], default: 'submit' },
      request: { type: 'object' },
      task_id: { type: 'string' },
      request_id: { type: 'string' },
    },
  },
  'hotword-table': {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string' },
      parameters: { type: 'object' },
      content: { type: 'string' },
    },
  },
  'console-management': {
    type: 'object',
    required: ['action'],
    properties: { action: { type: 'string' }, parameters: { type: 'object' } },
  },
  'voice-clone': {
    type: 'object',
    required: ['speaker_id'],
    properties: {
      speaker_id: { type: 'string' },
      audio_data: { type: 'string', description: 'Base64 audio or data URI' },
      audio_asset_id: { type: 'string' },
      format: { type: 'string' },
      text: { type: 'string' },
      language: { type: 'string', enum: ['zh', 'en'] },
      demo_text: { type: 'string' },
    },
  },
  'voice-design': {
    type: 'object',
    required: ['speaker_id', 'text'],
    properties: {
      speaker_id: { type: 'string' },
      text: { type: 'string' },
      prompt: { type: 'string' },
      language: { type: 'string', enum: ['zh', 'en'] },
    },
  },
  'voice-query': {
    type: 'object',
    required: ['speaker_id'],
    properties: { speaker_id: { type: 'string' } },
  },
  'raw-request': {
    type: 'object',
    properties: {
      path: { type: 'string' },
      body: { type: 'object' },
      resource: { type: 'string' },
      asr: { type: 'boolean' },
      // product=asr_stream 走 Node 子路径的流式识别；其余 product 走 HTTP 兜底。
      product: { type: 'string' },
      audio: { type: 'string' },
      mode: { type: 'string' },
      request: { type: 'object' },
      resource_id: { type: 'string' },
    },
  },
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function asRecord(value: unknown): Json {
  return asJson(value)
}

// ── podcast ────────────────────────────────────────────────────────────────

/** Validate and default a podcast SSE request (mirrors the Python validate_request). */
export function buildPodcastRequest(params: Json): Json {
  const body = { ...asRecord(params) }
  const action = typeof body.action === 'number' ? body.action : 0
  if (![0, 3, 4].includes(action))
    throw new ProviderError('invalid_input', 'podcast action must be 0, 3 or 4')
  const info = asRecord(body.input_info)
  if (action === 0 && !asString(body.input_text) && !asString(info.input_url))
    throw new ProviderError('invalid_input', 'action=0 requires input_text or input_info.input_url')
  if (action === 4 && !asString(body.prompt_text))
    throw new ProviderError('invalid_input', 'action=4 requires prompt_text')
  if (action === 3) {
    const texts = arr(body.nlp_texts)
    const total = texts.reduce<number>((sum, item) => {
      const entry = asJson(item)
      const value = entry.text
      if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 300 ||
        !asString(entry.speaker)
      )
        throw new ProviderError(
          'invalid_input',
          'nlp_texts entries need speaker and 1-300 char text',
        )
      return sum + value.length
    }, 0)
    if (!texts.length || total > 10_000)
      throw new ProviderError('invalid_input', 'nlp_texts is empty or exceeds 10000 characters')
  }
  const speakers = asRecord(body.speaker_info)
  if (Array.isArray(speakers.speakers) && speakers.speakers.length !== 2)
    throw new ProviderError(
      'invalid_input',
      'speaker_info.speakers must contain exactly two voices',
    )
  const config = asRecord(body.audio_config)
  const format = asString(config.format, 'mp3')
  const sampleRate = config.sample_rate ?? 24000
  if (
    !['mp3', 'pcm', 'aac', 'ogg_opus'].includes(format) ||
    ![16000, 24000, 48000].includes(Number(sampleRate))
  )
    throw new ProviderError('invalid_input', 'invalid audio_config.format or sample_rate')
  body.action = action
  body.audio_config = { format, sample_rate: Number(sampleRate) }
  const retry = asRecord(body.retry_info)
  if (Object.keys(retry).length) {
    if (
      !asString(retry.retry_task_id) ||
      typeof retry.last_finished_round_id !== 'number' ||
      (retry.last_finished_round_id as number) < 0
    )
      throw new ProviderError(
        'invalid_input',
        'retry_info needs retry_task_id and last_finished_round_id',
      )
  }
  return body
}

export interface PodcastEvent {
  event: number
  data: Json
}

/** Parse blank-line-terminated SSE messages (ignoring comments / id / retry). */
export function parsePodcastSse(raw: string): PodcastEvent[] {
  const result: PodcastEvent[] = []
  let event = ''
  let data: string[] = []
  for (const line of raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (!line) {
      if (data.length) {
        if (!/^\d+$/.test(event))
          throw new ProviderError('unknown', 'podcast SSE is missing a numeric event type')
        result.push({ event: Number(event), data: asJson(JSON.parse(data.join('\n'))) })
      }
      event = ''
      data = []
      continue
    }
    if (line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator >= 0 ? line.slice(0, separator) : line
    let value = separator >= 0 ? line.slice(separator + 1) : ''
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return result
}

export async function podcast(ctx: AdapterContext, params: Json): Promise<Json> {
  const body = buildPodcastRequest(params)
  const raw = await postText(ctx, PODCAST_PATH, body)
  return { events: parsePodcastSse(raw) }
}

// ── simultaneous interpretation ───────────────────────────────────────────

/**
 * 同传只返回请求计划，不联网。
 *
 * 官方协议是 WSS + protobuf（`TranslateRequest`），`AdapterContext.fetch` 带不动二进制帧，
 * 所以这里把连接头、事件号、开始会话的请求体和音频分片规则算好交给宿主，
 * 由宿主注入 WebSocket 与 protobuf 编解码器。
 */
export function simultaneousInterpretation(params: Json): Json {
  const mode = asString(params.mode, 's2t')
  const sourceLanguage = asString(params.source_language)
  const targetLanguage = asString(params.target_language)
  const request = interpretationStartRequest({
    mode,
    sourceLanguage,
    targetLanguage,
    request: asRecord(params.request),
  })
  return {
    ok: false,
    requires: 'wss+protobuf',
    endpoint: INTERPRETATION_ENDPOINT,
    resourceId: INTERPRETATION_RESOURCE_ID,
    headers: {
      'X-Api-Resource-Id': INTERPRETATION_RESOURCE_ID,
      'X-Api-Connect-Id': '<uuid>',
    },
    events: INTERPRETATION_EVENTS,
    chunkBytes: INTERPRETATION_CHUNK_BYTES,
    request,
    todo: 'Host must inject a binary WebSocket factory and protobuf codec',
  }
}

// ── translation / meeting notes / hotword table / console ──────────────────

export async function translation(ctx: AdapterContext, params: Json): Promise<Json> {
  const textList = arr(params.text_list).filter((item): item is string => typeof item === 'string')
  const targetLanguage = asString(params.target_language)
  if (
    !textList.length ||
    textList.length > 16 ||
    textList.some((item) => !item.trim()) ||
    !targetLanguage
  )
    throw new ProviderError(
      'invalid_input',
      'text_list needs 1-16 non-empty strings and a target_language',
    )
  const body: Json = {
    ...asRecord(params.request),
    text_list: textList,
    target_language: targetLanguage,
  }
  if (asString(params.source_language)) body.source_language = params.source_language
  if (params.corpus !== undefined) body.corpus = params.corpus
  return postJson(ctx, TRANSLATION_PATH, body, { resource: 'volc.speech.mt' })
}

export async function meetingNotes(ctx: AdapterContext, params: Json): Promise<Json> {
  const action = asString(params.action, 'submit')
  const requestId = asString(params.request_id) || crypto.randomUUID()
  if (action === 'submit') {
    const request = asRecord(params.request)
    return postJson(ctx, MINUTES_SUBMIT_PATH, request, {
      resource: 'volc.lark.minutes',
      extraHeaders: { 'X-Api-Request-Id': requestId, 'X-Api-Sequence': '-1' },
      idempotencyKey: requestId,
    })
  }
  if (action === 'query') {
    const taskId = asString(params.task_id)
    if (!taskId) throw new ProviderError('invalid_input', 'query requires task_id')
    return postJson(
      ctx,
      MINUTES_QUERY_PATH,
      { TaskID: taskId },
      {
        resource: 'volc.lark.minutes',
        extraHeaders: { 'X-Api-Request-Id': requestId },
        idempotencyKey: requestId,
      },
    )
  }
  throw new ProviderError('invalid_input', 'meeting-notes action must be submit or query')
}

const WORD_TABLE_ACTIONS = [
  'ListBoostingTableLimits',
  'CreateBoostingTable',
  'CheckBoostingTableName',
  'UpdateBoostingTable',
  'DeleteBoostingTable',
  'ListBoostingTable',
  'GetBoostingTable',
  'CreateCorrectTable',
  'CheckCorrectTableName',
  'UpdateCorrectTable',
  'DeleteCorrectTable',
  'ListCorrectTable',
  'GetCorrectTable',
]

export async function hotwordTable(ctx: AdapterContext, params: Json): Promise<Json> {
  const action = asString(params.action)
  if (!WORD_TABLE_ACTIONS.includes(action))
    throw new ProviderError('invalid_input', `Unsupported word table action: ${action}`)
  const body = { ...asRecord(params.parameters) }
  if (asString(params.content)) body.content = params.content
  const path = `${WORD_TABLE_PATH}?${new URLSearchParams({ Action: action }).toString()}`
  return postJson(ctx, path, body, { resource: 'volc.speech.hotword' })
}

/**
 * 语音控制面（OpenAPI）：用 IAM 的 AK/SK 做 HMAC-SHA256 签名。
 *
 * 没有 API Key 的退路，凭证缺失直接报 auth 错误。
 */
export async function consoleManagement(ctx: AdapterContext, params: Json): Promise<Json> {
  const action = asString(params.action)
  if (!action) throw new ProviderError('invalid_input', 'console-management requires an action')
  const parameters = asRecord(params.parameters)
  const version = asString(params.version)
  return consoleAction(ctx, action, parameters, version ? { version } : {})
}

// ── voice clone / design / query ───────────────────────────────────────────

/** Resolve a base64/data-URI audio field, or load an asset through `ctx.assets`. */
export async function audioData(
  ctx: AdapterContext,
  params: Json,
): Promise<{ data: string; format: string }> {
  const format = asString(params.format, 'wav')
  const provided = asString(params.audio_data)
  if (provided) {
    const base64 = provided.startsWith('data:') ? (provided.split(',')[1] ?? '') : provided
    if (!base64) throw new ProviderError('invalid_input', 'audio_data is empty')
    return { data: base64, format }
  }
  const assetId = asString(params.audio_asset_id)
  if (!assetId) throw new ProviderError('invalid_input', 'audio_data or audio_asset_id is required')
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for audio_asset_id')
  const loaded = await ctx.assets.load(assetId)
  if (!loaded.data.length) throw new ProviderError('invalid_input', 'Audio asset is empty')
  return { data: toBase64(loaded.data), format }
}

export async function voiceCloneOp(ctx: AdapterContext, params: Json): Promise<Json> {
  const speakerId = asString(params.speaker_id)
  if (!/^S_[A-Za-z0-9_-]{1,100}$/.test(speakerId))
    throw new ProviderError('invalid_input', 'voice clone needs a console-allocated S_ voice slot')
  const demoText = asString(params.demo_text)
  if (demoText && (demoText.length < 4 || demoText.length > 300))
    throw new ProviderError('invalid_input', 'demo_text must be 4-300 characters')
  const { data, format } = await audioData(ctx, params)
  const body: Json = {
    speaker_id: speakerId,
    language: asString(params.language, 'zh') === 'en' ? 1 : 0,
    audio: { data, format },
    extra_params: {
      enable_audio_denoise: false,
      disable_volume_normalization: true,
      ...(asString(params.text) ? { text: params.text } : {}),
      ...(demoText ? { demo_text: demoText } : {}),
    },
  }
  return postJson(ctx, VOICE_CLONE_PATH, body)
}

export async function voiceDesignOp(ctx: AdapterContext, params: Json): Promise<Json> {
  const speakerId = asString(params.speaker_id)
  if (!/^S_[A-Za-z0-9_-]{1,100}$/.test(speakerId))
    throw new ProviderError('invalid_input', 'voice design needs a console-allocated S_ voice slot')
  const previewText = asString(params.text)
  const prompt = asString(params.prompt)
  if (!previewText.trim() || previewText.length > 300 || (!prompt.trim() && prompt.length > 200))
    throw new ProviderError('invalid_input', 'text (<=300) and prompt (<=200) are required')
  return postJson(ctx, VOICE_DESIGN_PATH, {
    speaker_id: speakerId,
    text: previewText,
    language: asString(params.language, 'zh') === 'en' ? 1 : 0,
    prompt: { ...(prompt.trim() ? { text_prompt: prompt } : {}) },
  })
}

export async function voiceQueryOp(ctx: AdapterContext, params: Json): Promise<Json> {
  const speakerId = asString(params.speaker_id)
  if (!speakerId) throw new ProviderError('invalid_input', 'speaker_id is required')
  return postJson(ctx, GET_VOICE_PATH, { speaker_id: speakerId })
}

/** Dispatch a native operation. */
export async function runDoubaoNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
): Promise<unknown> {
  const p = asJson(params)
  switch (op) {
    case 'podcast':
      return podcast(ctx, p)
    case 'simultaneous-interpretation':
      return simultaneousInterpretation(p)
    case 'translation':
      return translation(ctx, p)
    case 'meeting-notes':
      return meetingNotes(ctx, p)
    case 'hotword-table':
      return hotwordTable(ctx, p)
    case 'console-management':
      return consoleManagement(ctx, p)
    case 'voice-clone':
      return voiceCloneOp(ctx, p)
    case 'voice-design':
      return voiceDesignOp(ctx, p)
    case 'voice-query':
      return voiceQueryOp(ctx, p)
    case 'raw-request': {
      // product=asr_stream 走 Node 子路径注入的流式识别实现（根入口不带 WebSocket）。
      if (p.product === 'asr_stream')
        throw new ProviderError(
          'unavailable',
          '流式识别需要 Node 子路径 @modelbay/doubao-speech/asr，请在 Node 环境下运行',
        )
      const path = asString(p.path)
      if (!path.startsWith('/'))
        throw new ProviderError('invalid_input', 'raw-request path must start with /')
      return postJson(ctx, path, asRecord(p.body), {
        resource: asString(p.resource) || undefined,
        asr: p.asr === true,
      })
    }
    default:
      throw new ProviderError('invalid_input', `Unknown Doubao native operation: ${op}`)
  }
}
