import { definePlatform } from '@modelbay/core'
import { createDoubaoAdapter, type DoubaoAdapterOptions } from './adapter'
import { ACCESS_TOKEN_NAMES, API_KEY_NAMES, APP_ID_NAMES } from './http'
import { doubaoSpeechTools } from './mcp/tools'
import { all } from './models/index'

const [apiKey, ...apiKeyAliases] = API_KEY_NAMES
const [appId, ...appIdAliases] = APP_ID_NAMES
const [accessToken, ...accessTokenAliases] = ACCESS_TOKEN_NAMES

/** 豆包语音：新版 API Key，或旧版 APP ID + Access Token。 */
export const doubaoSpeechPlatform = definePlatform<DoubaoAdapterOptions>({
  key: 'doubao-speech',
  title: 'Doubao Speech',
  primaryChannel: 'doubao-speech',
  secrets: {
    required: [[apiKey], [appId, accessToken]],
    // 控制台 OpenAPI 用的 IAM AK/SK，和语音 API Key 是两套凭证
    optional: ['VOLC_ACCESS_KEY_ID', 'VOLC_SECRET_ACCESS_KEY'],
    aliases: {
      [apiKey]: apiKeyAliases,
      [appId]: appIdAliases,
      [accessToken]: accessTokenAliases,
    },
  },
  createAdapters: (options = {}) => [createDoubaoAdapter(all, options)],
  mcp: { tools: doubaoSpeechTools },
})
