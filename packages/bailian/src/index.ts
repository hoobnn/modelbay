/**
 * `@modelbay/bailian` — Alibaba Bailian / DashScope adapter.
 *
 * Runtime-agnostic: only `ctx.fetch` / `ctx.secret` are used. Node-only image editing
 * lives in the optional `@modelbay/bailian/image-edit` subpath.
 */
import type { PlatformAdapter } from '@modelbay/core'
import { createBailianAdapter } from './adapter'
import { all } from './models/index'

export const bailianAdapter: PlatformAdapter = createBailianAdapter(all)

export { createBailianAdapter, defaultModel, NODE_ONLY_CAPABILITIES } from './adapter'
export { nativeOperationSchemas, BAILIAN_NATIVE_OPERATIONS } from './native'
export {
  DEFAULT_BASE_URL,
  API_KEY_NAMES,
  apiKey,
  apiKeySecrets,
  baseUrl,
  remoteError,
  retryableFor,
  withRetry,
  transportError,
  requestJson,
  readJson,
  readText,
  send,
  scrub,
  asJson,
  isJson,
} from './http'
export type { Json, Method, RequestOptions, TransportMessages } from './http'
export {
  SYNTH_PATH,
  QWEN_TTS_PATH,
  TTS_MODELS,
  QWEN_AUDIO_TTS,
  COSYVOICE_TTS,
  SYNTH_MODELS,
  INSTRUCTION_MODELS,
  TTS_CHUNK,
  splitText,
  instructionLength,
  resolveTtsModel,
  ttsRequest,
  checkTts,
  parseTtsResponse,
  synthesizeQwenAudioTts,
  parseUsage,
  audioFile,
} from './tts'
export type { TtsOptions, TtsRequest, TtsResult } from './tts'
export {
  ASR_MODEL,
  ASR_PATH,
  buildAsrRequest,
  parseAsrResponse,
  checkAsrModel,
  resolveAudio,
  transcribeAudio,
} from './asr'
export type { AsrOptions, AsrRequest, AsrResult } from './asr'
export {
  CUSTOMIZATION,
  ENROLLMENT,
  DEFAULT_VOICE_TARGET,
  CLONE_TARGETS,
  DESIGN_TARGETS,
  CLONE_LANGUAGES,
  VOICE_KINDS,
  CLONE_AUDIO_LIMIT,
  checkPrefix,
  checkCloneTarget,
  checkDesignTarget,
  cloneAudio,
  buildCloneRequest,
  buildDesignRequest,
  buildListVoicesRequest,
  buildGetVoiceRequest,
  parseVoiceResult,
  cloneVoice,
  designVoice,
  listVoices,
  getVoice,
} from './voice'
export type {
  CloneOptions,
  DesignOptions,
  ListVoicesOptions,
  VoiceResult,
  ListVoicesResult,
} from './voice'
export {
  RERANK_PATH,
  EMBED_TEXT_PATH,
  EMBED_MULTIMODAL_PATH,
  PORTRAIT_PATH,
  rerank,
  textEmbed,
  digitalHumanLipsync,
  runBailianNative,
} from './native'
