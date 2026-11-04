/**
 * 最小 stdio JSON-RPC server（不引入 @modelbay/sdk 等新依赖）。
 * 处理器由调用方注入（见 src/routing.ts），因此本文件纯、可被 stdio 子进程直接加载。
 * 处理 initialize / tools/list / tools/call / ping / resources|prompts/list。
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
  async function handle(request: unknown): Promise<JsonRpcResponse | null> {
    if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return fail(idOf(request), { code: -32600, message: 'Invalid Request' })
    }
    const req = request as unknown as JsonRpcRequest
    // 没有 id 的是通知（notifications/*），协议规定不得回复。
    if (!('id' in req)) return null
    const id = idOf(req) ?? null
    const params = req.params ?? {}

    switch (req.method) {
      case 'initialize': {
        const requested = params.protocolVersion
        return ok(id, {
          protocolVersion: typeof requested === 'string' ? requested : DEFAULT_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: {},
            prompts: {},
          },
          serverInfo: handlers.serverInfo,
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools: await handlers.listTools() })
      case 'tools/call': {
        const name = params.name
        if (typeof name !== 'string') {
          return fail(id, { code: -32602, message: 'tools/call 需要字符串 name' })
        }
        const args = isObject(params.arguments) ? params.arguments : {}
        try {
          const result = await handlers.callTool(name, args)
          return ok(id, result)
        } catch (error) {
          // 工具执行错误按 MCP 约定作为带 isError 的结果返回，不崩 server。
          const toolError: CallToolResult = {
            content: [{ type: 'text', text: errorMessage(error) }],
            isError: true,
          }
          return ok(id, toolError)
        }
      }
      case 'resources/list':
        return ok(id, { resources: [] })
      case 'resources/templates/list':
        return ok(id, { resourceTemplates: [] })
      case 'prompts/list':
        return ok(id, { prompts: [] })
      default:
        return fail(id, { code: -32601, message: `Method not found: ${req.method}` })
    }
  }

  return { handle }
}
