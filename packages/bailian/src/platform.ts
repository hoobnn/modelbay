import { definePlatform } from '@modelbay/core'
import { createBailianAdapter, type BailianAdapterOptions } from './adapter'
import { bailianTools } from './mcp/tools'
import { all } from './models/index'
import { createBailianPlanAdapter, PLAN_API_KEY } from './plan'

/** 阿里云百炼：按量（`bailian`）与 Token Plan 套餐（`bailian-plan`，只接文本对话）两个渠道。 */
export const bailianPlatform = definePlatform<BailianAdapterOptions>({
  key: 'bailian',
  title: 'Alibaba Bailian',
  primaryChannel: 'bailian',
  channelSecrets: { bailian: ['BAILIAN_API_KEY'], 'bailian-plan': [PLAN_API_KEY] },
  secrets: {
    required: [['BAILIAN_API_KEY'], [PLAN_API_KEY]],
    optional: ['BAILIAN_BASE_URL', 'BAILIAN_POLL_INTERVAL_MS'],
    aliases: {
      BAILIAN_API_KEY: ['DASHSCOPE_API_KEY'],
      BAILIAN_BASE_URL: ['DASHSCOPE_BASE_URL'],
      BAILIAN_POLL_INTERVAL_MS: ['DASHSCOPE_POLL_INTERVAL_MS'],
    },
  },
  createAdapters: (options = {}) => [
    createBailianAdapter(all, options),
    createBailianPlanAdapter(all, options),
  ],
  mcp: { tools: bailianTools },
})
