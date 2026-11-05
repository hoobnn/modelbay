/**
 * Optional Node-only subpath `@modelbay/ark/node`. Nothing here is imported by
 * the root entry; it is only loaded when the host explicitly needs TOS / S3
 * reference uploads, the signed plan model directory or the plan ASR.
 */
import type { ArkAdapterOptions } from '../reference'
import { transcribePlanAudio } from './asr'
import { listPlanModels } from './plan-directory'
import { uploadReferenceVideo } from './tos'

export * from './tos'
export * from './plan-directory'
export * from './asr'

/**
 * 一次注入全部 Node 专属能力：`createArkPlanAdapter(models, nodeOptions)`
 * （按量渠道用 `createArkAdapter(models, nodeOptions)` 也行，多出的项会被忽略）。
 */
export const nodeOptions: ArkAdapterOptions = {
  uploadVideo: uploadReferenceVideo,
  transcribePlan: transcribePlanAudio,
  listPlanModels,
}
