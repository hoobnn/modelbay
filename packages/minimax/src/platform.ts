import { definePlatform } from '@modelbay/core'
import { createMinimaxAdapter } from './adapter'
import { minimaxTools } from './mcp/tools'
import { all } from './models/index'

/** MiniMax。 */
export const minimaxPlatform = definePlatform({
  key: 'minimax',
  title: 'MiniMax',
  primaryChannel: 'minimax',
  secrets: {
    required: [['MINIMAX_API_KEY']],
    optional: ['MINIMAX_REGION', 'MINIMAX_BASE_URL'],
  },
  createAdapters: () => [createMinimaxAdapter(all)],
  mcp: { tools: minimaxTools },
})
