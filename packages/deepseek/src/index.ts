import { createDeepseekAdapter } from './adapter'
import { all } from './models/index'

export const models = all
export { createDeepseekAdapter } from './adapter'

export const deepseekAdapter = createDeepseekAdapter()
export { deepseekPlatform } from './platform'
export { chat } from './chat'
export * from './native'
export * from './speech'

export { deepseekTools } from './mcp/tools'
