/** MCP 生成器与 stdio server 的公共类型。 */
import type {
  ToolGroup as CoreToolGroup,
  ToolNature as CoreToolNature,
  ToolSpec,
} from '@modelbay/core'

/** 打开哪些工具组的环境变量（逗号分隔）。 */
export const GROUP_ENV_VAR = 'MODELBAY_MCP_GROUPS'

/** 工具组开关。默认只暴露 core；其余三组默认不启用。 */
export const TOOL_GROUPS = [
  'core',
  'realtime',
  'management',
  'node',
] as const satisfies readonly CoreToolGroup[]
export type ToolGroup = (typeof TOOL_GROUPS)[number]

export const MCP_TOOL_GROUPS: {
  readonly all: readonly ToolGroup[]
  readonly default: readonly ToolGroup[]
  readonly optional: readonly ToolGroup[]
} = {
  all: TOOL_GROUPS,
  default: ['core'],
  optional: ['realtime', 'management', 'node'],
}

/**
 * 工具的操作性质，是「能力元数据」的一部分：annotations 与路由都从它派生，
 * 不直接照抄基线（基线条目有缺 destructiveHint 的情况）。
 */
export const TOOL_NATURES = [
  'generate',
  'query',
  'mutate',
  'local',
  'realtime',
] as const satisfies readonly CoreToolNature[]
export type ToolNature = (typeof TOOL_NATURES)[number]

export interface JsonSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, Record<string, unknown>>
  required?: string[]
  [key: string]: unknown
}

export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

/** MCP tools/list 返回的工具（公开形状，不含内部字段）。 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  annotations: ToolAnnotations
}

/** 工具定义由各平台包的 `src/mcp/tools.ts` 提供，类型在 core。 */
export type { ToolSpec }

/** tools/call 的路由描述。 */
export type ToolRoute =
  | { kind: 'submit'; capability: string; nature: ToolNature }
  | { kind: 'native'; op: string; nature: ToolNature }
  | { kind: 'local'; handler: LocalHandler; nature: ToolNature }

export type LocalHandler =
  | 'tool-help'
  | 'capabilities'
  | 'models'
  | 'jobs'
  | 'voices'
  | 'usage-examples'

/** 生成后的工具（含内部字段，供 server 路由与分组过滤用）。 */
export interface GeneratedTool extends MCPTool {
  group: ToolGroup
  route: ToolRoute
  mapArguments?: ToolSpec['mapArguments']
}

export interface GeneratedToolSet {
  /** 平台键（`PlatformDescriptor.key`）。 */
  platform: string
  /** 全量工具（含所有组）。 */
  all: GeneratedTool[]
  routes: Map<string, ToolRoute>
  byName: Map<string, GeneratedTool>
}

/** tools/call 的内容块：文本，或 MCP 标准的 base64 图片 / 音频 / 内嵌资源。 */
export interface TextContent {
  type: 'text'
  text: string
}

export type CallToolContent =
  | TextContent
  | { type: 'image' | 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }

export interface CallToolResult {
  /** 第一个块总是文本说明；字节结果跟在后面 */
  content: [TextContent, ...CallToolContent[]]
  isError?: boolean
  structuredContent?: unknown
}

/** JSON-RPC 2.0 消息。 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: JsonRpcError
}

export interface ServerInfo {
  name: string
  version: string
}

/** createServer 的处理器由调用方注入，server 本身不依赖 core / 适配器。 */
export interface ServerHandlers {
  serverInfo: ServerInfo
  protocolVersion?: string
  listTools(): MCPTool[] | Promise<MCPTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
}
