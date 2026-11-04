/**
 * `@modelbay/doubao-speech` — Doubao Speech adapter.
 *
 * Exports `speechSettings`, `synthesizeSpeech` and `TTS_VOICES` for
 * `@modelbay/ark`'s Agent Plan TTS (the only allowed cross-adapter dependency).
 * Runtime-agnostic root entry; Node-only ASR codec lives in `@modelbay/doubao-speech/asr`.
 */
import type { PlatformAdapter } from '@modelbay/core'
import { createDoubaoAdapter } from './adapter'
import { all } from './models/index'

export const doubaoAdapter: PlatformAdapter = createDoubaoAdapter(all)

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
export { nativeOperationSchemas, DOUBAO_NATIVE_OPERATIONS } from './native'
export {
  HOST,
  API_KEY_NAMES,
  APP_ID_NAMES,
  ACCESS_TOKEN_NAMES,
  SECRET_NAMES,
  firstSecret,
  hasCredentials,
  headers,
  failure,
  incomplete,
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
export type { Json, Method, PostOptions, TransportMessages } from './http'
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
  PODCAST_PATH,
  TRANSLATION_PATH,
  MINUTES_SUBMIT_PATH,
  MINUTES_QUERY_PATH,
  WORD_TABLE_PATH,
  VOICE_CLONE_PATH,
  VOICE_DESIGN_PATH,
  GET_VOICE_PATH,
  INTERPRETATION_ENDPOINT,
  INTERPRETATION_RESOURCE_ID,
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
  InMemoryRealtimeSession,
  openRealtimeSession,
} from './session'
export type { RealtimeSessionConfig, RealtimeSocketFactory, RealtimeSessionHandle } from './session'
