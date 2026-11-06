import { definePlatform } from '@modelbay/core'
import type { OpenAIAdapterOptions } from './mask'
import { all } from './models/index'
import { createOpenAIAdapter, createOpenAICompatibleAdapter } from './index'
import { openaiTools } from './mcp/tools'

/** OpenAI 官方渠道（`openai`）与 OpenAI 兼容渠道（`openai-compatible`）。 */
export const openaiPlatform = definePlatform<OpenAIAdapterOptions>({
  key: 'openai',
  title: 'OpenAI',
  primaryChannel: 'openai',
  secrets: {
    required: [['OPENAI_API_KEY'], ['OPENAI_COMPATIBLE_API_KEY']],
    optional: ['OPENAI_COMPATIBLE_BASE_URL'],
    aliases: { OPENAI_COMPATIBLE_API_KEY: ['COMPATIBLE_API_KEY'] },
  },
  createAdapters: (options = {}) => [
    createOpenAIAdapter(all, options),
    createOpenAICompatibleAdapter(all, options),
  ],
  mcp: { tools: openaiTools },
})
