import { definePlatform } from '@modelbay/core'
import { createDeepseekAdapter } from './adapter'
import { deepseekTools } from './mcp/tools'
import { all } from './models/index'

export const deepseekPlatform = definePlatform({
  key: 'deepseek',
  title: 'DeepSeek',
  primaryChannel: 'deepseek',
  models: all,
  secrets: {
    required: [['DEEPSEEK_API_KEY']],
    optional: ['DEEPSEEK_BASE_URL'],
  },
  createAdapters: () => [createDeepseekAdapter()],
  mcp: { tools: deepseekTools },
})
