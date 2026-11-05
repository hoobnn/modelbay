/**
 * `@modelbay/doubao-speech/node` — Node-only helpers: streaming ASR and
 * simultaneous interpretation over WebSocket (`ws`).
 *
 * Kept out of the root entry so the adapter stays runtime-agnostic.
 */
export * from './asr'
export * from './interpretation'

import type { DoubaoAdapterOptions } from '../adapter'
import type { Json } from '../http'
import { runAsrStream } from './asr'
import { interpretAudio, type InterpretOptions } from './interpretation'

/** 一次注入全部 Node 专属能力：`createDoubaoAdapter(models, nodeOptions)`。 */
export const nodeOptions: DoubaoAdapterOptions = {
  // native 参数按 JSON 透传；字段校验在 interpretAudio 内部完成
  interpretation: async (ctx, params) =>
    (await interpretAudio(ctx, params as unknown as InterpretOptions)) as unknown as Json,
  asr: runAsrStream,
}
