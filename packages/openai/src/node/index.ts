/**
 * Optional Node-only subpath `@modelbay/openai/node`. Not imported by the root
 * entry; loaded only when the host needs sharp-based mask conversion.
 */
export * from './mask'

import type { OpenAIAdapterOptions } from '../mask'
import { editMask } from './mask'

/** 一次注入全部 Node 专属能力：`createOpenAIAdapter(models, nodeOptions)`。 */
export const nodeOptions: OpenAIAdapterOptions = { editMask }
