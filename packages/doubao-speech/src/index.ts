/**
 * `@modelbay/doubao-speech` — Doubao Speech adapter.
 *
 * Exports `speechSettings`, `synthesizeSpeech` and `TTS_VOICES` for
 * `@modelbay/ark`'s Agent Plan TTS (the only allowed cross-adapter dependency).
 * Runtime-agnostic root entry; Node-only ASR codec lives in `@modelbay/doubao-speech/asr`.
 */
import { createDoubaoAdapter, type DoubaoAdapter } from './adapter'
import { all } from './models/index'

export const doubaoAdapter: DoubaoAdapter = createDoubaoAdapter(all)

// Cross-adapter API consumed by @modelbay/ark.
export { speechSettings, synthesizeSpeech, TTS_VOICES } from './speech'
export type { SpeechSettings } from './speech'

export {
  createDoubaoAdapter,
  defaultModel,
  buildAudioCreateBody,
  buildFlashAsrBody,
  parseFlashAsr,
} from './adapter'
export type { DoubaoAdapter, DoubaoVoiceApi } from './adapter'
export {
  CLONE_FORMATS,
  CLONE_SAMPLE,
  cloneState,
  cloneVoice,
  designVoice,
  voiceStatus,
} from './voice'
export { nativeOperationSchemas, DOUBAO_NATIVE_OPERATIONS } from './native'
export {
  HOST,
  API_KEY_NAMES,
  APP_ID_NAMES,
  ACCESS_TOKEN_NAMES,
  SECRET_NAMES,
  firstSecret,
  readSecret,
  hasCredentials,
  headers,
  failure,
  incomplete,
  postRaw,
  postText,
  postJson,
  events,
  send,
  readText,
  scrub,
  asJson,
  isJson,
  retryableFor,
  withRetry,
  transportError,
} from './http'
export type { Json, Method, PostOptions, PostResult, TransportMessages } from './http'
export {
  resolveSpeechSettings,
  buildSpeechRequest,
  decodeAudioStream,
  pcmWav,
  parseResponseBody,
  customVoiceId,
  text,
} from './speech'
export {
  CONSOLE_ENDPOINT,
  CONSOLE_HOST,
  CONSOLE_SERVICE,
  CONSOLE_VERSIONS,
  buildQuery,
  consoleAction,
  consoleRoute,
  quoteValue,
  signedHeaders,
  utcTimestamp,
} from './console'
export type { ConsoleActionOptions, SignedHeaderOptions } from './console'
export {
  INTERPRETATION_CHUNK_BYTES,
  INTERPRETATION_EVENTS,
  INTERPRETATION_MODES,
  interpretationChunks,
  interpretationHeaders,
  interpretationStartRequest,
} from './interpretation'
export type { InterpretationOptions } from './interpretation'
export {
  PODCAST_PATH,
  TRANSLATION_PATH,
  MINUTES_SUBMIT_PATH,
  MINUTES_QUERY_PATH,
  WORD_TABLE_PATH,
  VOICE_CLONE_PATH,
  VOICE_DESIGN_PATH,
  GET_VOICE_PATH,
  buildPodcastRequest,
  parsePodcastSse,
  podcast,
  simultaneousInterpretation,
  translation,
  meetingNotes,
  hotwordTable,
  consoleManagement,
  audioData,
  voiceCloneOp,
  voiceDesignOp,
  voiceQueryOp,
  runDoubaoNative,
} from './native'
export type { PodcastEvent } from './native'
export {
  REALTIME_DIALOGUE_PATH,
  REALTIME_SEED_PATH,
  REALTIME_BIDIRECTION_PATH,
  REALTIME_HOST,
  REALTIME_MODES,
  createRealtimeEvent,
  InMemoryRealtimeSession,
  openRealtimeSession,
  parseRealtimeEvent,
  validateRealtimeVideo,
} from './session'
export type {
  RealtimeEventOptions,
  RealtimeMode,
  RealtimeSessionConfig,
  RealtimeSocketFactory,
  RealtimeSessionHandle,
} from './session'
