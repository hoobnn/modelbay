/**
 * stdio JSON-RPC 分发器。工具处理器和技能目录由调用方注入（见 src/routing.ts）。
 */
import type {
  CallToolResult,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  ServerHandlers,
} from './types'

export interface McpServer {
  handle(request: unknown): Promise<JsonRpcResponse | null>
}

const DEFAULT_PROTOCOL_VERSION = '2024-11-05'
const LEGACY_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  DEFAULT_PROTOCOL_VERSION,
] as const
const CURRENT_PROTOCOL_VERSION = '2026-07-28'
const SUPPORTED_VERSIONS = [CURRENT_PROTOCOL_VERSION, ...LEGACY_VERSIONS]
const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities'
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo'
const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'
const NO_CACHE = { ttlMs: 0, cacheScope: 'private' } as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function fail(id: number | string | null, error: JsonRpcError): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error }
}

function idOf(value: unknown): number | string | null {
  if (isObject(value) && 'id' in value) {
    const id = value.id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createServer(handlers: ServerHandlers): McpServer {
  const { serverInfo, instructions, skills } = handlers
  const features = {
    resources: {},
    prompts: {},
    ...(skills ? { extensions: { [SKILLS_EXTENSION]: {} } } : {}),
  }
  const guidance = instructions ? { instructions } : {}

  async function handle(request: unknown): Promise<JsonRpcResponse | null> {
    if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return fail(idOf(request), { code: -32600, message: 'Invalid Request' })
    }
    const req = request as unknown as JsonRpcRequest
    // 没有 id 的是通知（notifications/*），协议规定不得回复。
    if (!('id' in req)) return null
    const id = idOf(req)
    const params = req.params ?? {}
    const meta = isObject(params._meta) ? params._meta : {}
    const modern =
      req.method === 'server/discover' ||
      PROTOCOL_VERSION_KEY in meta ||
      CLIENT_CAPABILITIES_KEY in meta

    if (modern) {
      const version = meta[PROTOCOL_VERSION_KEY]
      if (typeof version !== 'string' || !isObject(meta[CLIENT_CAPABILITIES_KEY])) {
        return fail(id, { code: -32602, message: 'Missing or invalid MCP request metadata' })
      }
      if (version !== CURRENT_PROTOCOL_VERSION) {
        return fail(id, {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: SUPPORTED_VERSIONS, requested: version },
        })
      }
    }

    function complete(result: object, cacheable = false): JsonRpcResponse {
      return ok(
        id,
        modern
          ? {
              ...result,
              resultType: 'complete',
              _meta: { [SERVER_INFO_KEY]: serverInfo },
              ...(cacheable ? NO_CACHE : {}),
            }
          : result,
      )
    }

    switch (req.method) {
      case 'initialize': {
        if (modern) break
        const requested = params.protocolVersion
        const protocolVersion =
          typeof requested === 'string'
            ? (LEGACY_VERSIONS.find((version) => version === requested) ?? LEGACY_VERSIONS[0])
            : DEFAULT_PROTOCOL_VERSION
        return ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false }, ...features },
          serverInfo,
          ...guidance,
        })
      }
      case 'server/discover':
        return complete(
          {
            supportedVersions: SUPPORTED_VERSIONS,
            capabilities: { tools: {}, ...features },
            ...guidance,
          },
          true,
        )
      case 'ping':
        return complete({})
      case 'tools/list':
        return complete({ tools: await handlers.listTools() }, true)
      case 'tools/call': {
        const name = params.name
        if (typeof name !== 'string') {
          return fail(id, { code: -32602, message: 'tools/call 需要字符串 name' })
        }
        const args = isObject(params.arguments) ? params.arguments : {}
        try {
          const result = await handlers.callTool(name, args)
          return complete(result)
        } catch (error) {
          // 工具执行错误按 MCP 约定作为带 isError 的结果返回，不崩 server。
          const toolError: CallToolResult = {
            content: [{ type: 'text', text: errorMessage(error) }],
            isError: true,
          }
          return complete(toolError)
        }
      }
      case 'skills/list':
        if (!skills) break
        if (params.cursor !== undefined) {
          return fail(id, { code: -32602, message: 'Invalid skills/list cursor' })
        }
        return complete({ skills: [...skills.entries.values()] }, true)
      case 'skills/get': {
        if (!skills) break
        const entry = typeof params.uri === 'string' ? skills.entries.get(params.uri) : undefined
        if (!entry) return fail(id, { code: -32602, message: 'Expected a published SKILL.md URI' })
        return complete({ skill: entry })
      }
      case 'resources/list':
        return complete(
          { resources: [...(skills?.files.values() ?? [])].map(({ text: _, ...file }) => file) },
          true,
        )
      case 'resources/read': {
        if (typeof params.uri !== 'string') {
          return fail(id, { code: -32602, message: 'resources/read requires a string URI' })
        }
        const file = skills?.files.get(params.uri)
        if (!file) {
          return fail(id, { code: modern ? -32602 : -32002, message: 'Resource not found' })
        }
        const { uri, mimeType, text } = file
        return complete({ contents: [{ uri, mimeType, text }] }, true)
      }
      case 'resources/templates/list':
        return complete({ resourceTemplates: [] }, true)
      case 'prompts/list':
        return complete({ prompts: [] }, true)
    }
    return fail(id, { code: -32601, message: `Method not found: ${req.method}` })
  }

  return { handle }
}
