/**
 * 跨平台通用的工具名约定：同名工具在各平台语义一致，按名字推断能力、本地处理器、性质与分组。
 * 这里不含任何模型 ID、上下限、默认值或生命周期字符串（那部分由 src/derive.ts 从声明派生），
 * 也不含平台独有的工具：平台独有工具在自己的 `src/mcp/tools.ts` 里写 `capability` /
 * `native` / `nature` / `group`，优先于这里的约定。详见 docs/mcp.md。
 */
import type { LocalHandler, ToolGroup, ToolNature } from './types'

/** 通用工具名 → 归一化能力（0003），用于模型参数派生与 submit 路由。 */
const TOOL_CAPABILITY: Record<string, string> = {
  chat: 'text.chat',
  embed: 'text.embed',
  generate_image: 'image.generate',
  generate_video: 'video.generate',
  text_to_speech: 'audio.speech',
  speech_to_text: 'audio.transcribe',
  clone_voice: 'voice.clone',
  design_voice: 'voice.design',
}

/** MCP 本地工具：由 server 直接从生成结果 / 声明 / 任务存储回答，处理器实现在本包。 */
const TOOL_LOCAL: Record<string, LocalHandler> = {
  get_tool_help: 'tool-help',
  list_capabilities: 'capabilities',
  list_speech_capabilities: 'capabilities',
  get_speech_usage_examples: 'usage-examples',
  list_models: 'models',
  list_jobs: 'jobs',
  get_job: 'jobs',
  recover_job: 'jobs',
  get_voice: 'voices',
  list_voices: 'voices',
}

/** 本地工具里联网查询的那几个（其余本地工具都是不联网的 `local`）。 */
const QUERY_TOOLS = new Set(['get_job', 'recover_job', 'get_voice', 'list_voices'])

/**
 * 超出基线的新工具：从声明派生可用模型与生命周期，避免客户端硬编码模型清单。
 * 名字要符合 MCP 客户端的工具名约束 `^[a-zA-Z0-9_-]{1,64}$`（Claude 会拒绝带冒号的名字），
 * 所以不用 `models:list`；也不叫 `list_models`，那是百炼基线里的官方模型目录查询，语义不同。
 */
export const EXTRA_TOOL_NAMES = ['list_declared_models'] as const

export interface ToolMeta {
  capability?: string
  localHandler?: LocalHandler
  nature: ToolNature
  group: ToolGroup
}

/** 按通用工具名约定推断元数据；平台在工具定义里写明的字段优先于这里。 */
export function deriveMeta(name: string): ToolMeta {
  const localHandler = TOOL_LOCAL[name]
  const local = localHandler !== undefined || (EXTRA_TOOL_NAMES as readonly string[]).includes(name)
  return {
    ...(TOOL_CAPABILITY[name] ? { capability: TOOL_CAPABILITY[name] } : {}),
    ...(localHandler ? { localHandler } : {}),
    nature: QUERY_TOOLS.has(name) ? 'query' : local ? 'local' : 'generate',
    group: 'core',
  }
}

/** 供文档/测试使用：某工具是否被分到可选组。 */
export function isOptionalGroup(group: ToolGroup): boolean {
  return group !== 'core'
}
