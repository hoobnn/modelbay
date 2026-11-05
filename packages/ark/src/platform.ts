import { definePlatform } from '@modelbay/core'
import { arkTools } from './mcp/tools'
import { all } from './models/index'
import { REFERENCE_STORAGE_KEYS, type ArkAdapterOptions } from './reference'
import { createArkAdapter, createArkPlanAdapter } from './index'

/** 火山方舟：按量（`ark`）与套餐（`ark-plan`）两个渠道。 */
export const arkPlatform = definePlatform<ArkAdapterOptions>({
  key: 'ark',
  title: 'Volcengine Ark',
  primaryChannel: 'ark',
  secrets: {
    required: [['ARK_API_KEY'], ['ARK_AGENT_PLAN_API_KEY']],
    optional: [
      ...Object.values(REFERENCE_STORAGE_KEYS),
      'ARK_TOS_ACCESS_KEY',
      'ARK_TOS_SECRET_KEY',
      'ARK_PLAN_ACCESS_KEY',
      'ARK_PLAN_SECRET_KEY',
    ],
  },
  createAdapters: (options = {}) => [
    createArkAdapter(all, options),
    createArkPlanAdapter(all, options),
  ],
  mcp: { tools: arkTools },
})
