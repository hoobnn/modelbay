/** @modelbay/mcp 公开入口：MCP 工具生成器 + stdio server + 启动器。 */

export { generateTools, listTools, toMCPTool, toolNames } from './generate'
export type { GenerateOptions } from './generate'

export { createServer } from './server'
export type { McpServer } from './server'

export { createHandlers } from './routing'
export type { RoutingOptions } from './routing'

export { startServer, loadAdapter, resolveGroups, collectSecrets } from './launch'
export type { StartOptions, StartedServer } from './launch'

export { attachStdioTransport } from './stdio-transport'
export type { StdioServerLike, StdioTransportOptions } from './stdio-transport'

export { FramedReader, encodeMessage, parseContentLength } from './framing'
export type { DecodedMessage, Framing } from './framing'

export { loadCatalog, cloneCatalog, isCatalogEntry } from './catalog/index'

export { deriveAnnotations, deriveInputSchema, deriveModelParameterPart } from './derive'
export type { ModelParameterPart } from './derive'

export { deriveMeta, ALIASES, EXTRA_TOOL_NAMES, isOptionalGroup } from './tool-meta'
export type { ToolMeta } from './tool-meta'

export { PLATFORMS, GROUP_ENV_VAR } from './platform'
export type { PlatformMeta } from './platform'

export { PLATFORM_KEYS, MCP_TOOL_GROUPS, TOOL_GROUPS, TOOL_NATURES } from './types'
export type {
  CallToolContent,
  CallToolResult,
  CatalogEntry,
  GeneratedTool,
  GeneratedToolSet,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonSchema,
  LocalHandler,
  MCPTool,
  PlatformKey,
  ServerHandlers,
  ServerInfo,
  ToolAnnotations,
  ToolGroup,
  ToolNature,
  ToolRoute,
} from './types'
