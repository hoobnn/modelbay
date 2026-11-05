/**
 * `@modelbay/minimax` — MiniMax adapter (chat, image, H3 video, speech, music).
 * Runtime-agnostic: only `ctx.fetch` / `ctx.secret` are used.
 */
import type { PlatformAdapter } from '@modelbay/core'
import { createMinimaxAdapter } from './adapter'
import { all } from './models/index'

/** 本平台的全部模型声明。 */
export const models = all
export const minimaxAdapter: PlatformAdapter = createMinimaxAdapter(all)

export { createMinimaxAdapter, defaultModel, fromHex } from './adapter'
export { nativeOperationSchemas, MINIMAX_NATIVE_OPERATIONS } from './native'
export {
  CN_BASE_URL,
  GLOBAL_BASE_URL,
  apiKey,
  baseUrl,
  errorCode,
  requestJson,
  readJson,
  readText,
  region,
  send,
  scrub,
  asJson,
  isJson,
  retryableFor,
  withRetry,
  transportError,
} from './http'
export type { Json, Method, RequestOptions, TransportMessages } from './http'
export {
  CONTEXT_IR_PATH,
  RERENDER_PATH,
  UPLOAD_PATH,
  VOICE_CLONE_PATH,
  VOICE_DESIGN_PATH,
  QUERY_PATH,
  buildContextIrRequest,
  buildRerenderRequest,
  submitNativeTask,
  uploadFile,
  voiceClone,
  voiceDesign,
  listVideoTasks,
  listModels,
  assetDataUrl,
  runMinimaxNative,
} from './native'
export {
  cloneVoice,
  designVoice,
  minimaxVoiceClone,
  minimaxVoiceDesign,
  VOICE_PREVIEW_MODEL,
} from './voice'
export { minimaxPlatform } from './platform'
