/**
 * `@modelbay/bailian/node` — Node-only helpers (mask processing via `sharp`).
 *
 * Kept out of the root entry so the adapter stays runtime-agnostic.
 */
export * from './image-edit'

import type { BailianAdapterOptions } from '../adapter'
import { prepareImageEditRequest, prepareImageProcessRequest } from './image-edit'

/** 一次注入全部 Node 专属能力：`createBailianAdapter(models, nodeOptions)`。 */
export const nodeOptions: BailianAdapterOptions = {
  edit: prepareImageEditRequest,
  process: prepareImageProcessRequest,
}
