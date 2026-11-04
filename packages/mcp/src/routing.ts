/**
 * 把 tools/list 与 tools/call 接到生成器结果、PlatformAdapter 与 AdapterContext。
 * tools/call 按生成时记录的 route 分发：
 *   submit → adapter.submit；native → adapter.native；local → 本地只读回答。
 * 未配置 key / 适配器未就绪时返回清晰错误（isError 结果），绝不抛到 stdio 循环里。
 */
import { lifecycleNotice } from '@modelbay/core'
import type {
  AdapterContext,
  AdapterRequest,
  ModelDeclaration,
  PlatformAdapter,
} from '@modelbay/core'
import { listTools } from './generate'
import type {
  CallToolResult,
  GeneratedToolSet,
  LocalHandler,
  ServerInfo,
  ServerHandlers,
  ToolGroup,
} from './types'

export interface RoutingOptions {
  set: GeneratedToolSet
  adapter?: PlatformAdapter
  context: AdapterContext
  groups: readonly ToolGroup[]
  keyEnvVars: readonly string[]
  serverInfo: ServerInfo
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function result(value: unknown): CallToolResult {
  const text = toText(value)
  const structured =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function firstCapability(set: GeneratedToolSet): string {
  for (const tool of set.all) {
    if (tool.route.kind === 'submit') return tool.route.capability
  }
  return ''
}

function derivedDefaultModel(tool: GeneratedToolSet['all'][number]): string {
  const model = tool.inputSchema.properties?.model
  if (model && typeof model.default === 'string') return model.default
  return ''
}

function localResult(
  handler: LocalHandler,
  args: Record<string, unknown>,
  set: GeneratedToolSet,
  models: readonly ModelDeclaration[],
): CallToolResult {
  switch (handler) {
    case 'tool-help': {
      const name = typeof args.tool === 'string' ? args.tool : undefined
      const tool = name ? set.byName.get(name) : undefined
      if (tool) return result(tool.description)
      return result(`可用工具：\n${[...set.byName.keys()].sort().join('\n')}`)
    }
    case 'capabilities': {
      const capabilities = [
        ...new Set(
          set.all
            .filter((tool) => tool.route.kind === 'submit')
            .map((tool) => (tool.route.kind === 'submit' ? tool.route.capability : '')),
        ),
      ].sort()
      const nativeOperations = [
        ...new Set(
          set.all
            .filter((tool) => tool.route.kind === 'native')
            .map((tool) => (tool.route.kind === 'native' ? tool.route.op : '')),
        ),
      ].sort()
      return result({ capabilities, nativeOperations })
    }
    case 'models': {
      const filter = typeof args.capability === 'string' ? args.capability : undefined
      const list = models
        .filter((model) => !filter || model.capabilities.some((cap) => cap === filter))
        .map((model) => ({
          canonicalId: model.canonicalId,
          title: model.title,
          capabilities: model.capabilities,
          status: model.lifecycle.status,
          notice: lifecycleNotice(model),
        }))
      return result({ models: list })
    }
    case 'voices': {
      const voices = models.flatMap((model) =>
        (model.voices ?? []).map((voice) => ({
          model: model.canonicalId,
          ...voice,
        })),
      )
      return result(
        voices.length > 0
          ? { voices }
          : { voices: [], note: '当前声明未登记预置音色；音色列表来自平台侧，需联网查询' },
      )
    }
    case 'jobs': {
      return result({
        note: '本地任务记录由 @modelbay/core 的 JobStore 管理；MCP server 不落盘、不缓存 job 记录。',
        echo: args,
      })
    }
    case 'usage-examples': {
      return result({
        note: '按工具名调用 get_tool_help 读取完整用法；工具清单见 tools/list。',
        tools: [...set.byName.keys()].sort(),
      })
    }
    default:
      return errorResult(`未知的本地处理器 ${String(handler)}`)
  }
}

export function createHandlers(options: RoutingOptions): ServerHandlers {
  const { set, adapter, context, groups, keyEnvVars, serverInfo } = options
  const models: readonly ModelDeclaration[] = adapter?.models ?? []
  const fallbackCapability = firstCapability(set)

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tool = set.byName.get(name)
    if (!tool) return errorResult(`未知工具 ${name}`)
    const route = tool.route

    if (route.kind === 'local') {
      return localResult(route.handler, args, set, models)
    }

    // 未配置 key：返回清晰错误而不是崩溃；log 走 stderr（由 context.log 决定是否输出）。
    const missing = keyEnvVars.filter((env) => !context.secret(env))
    if (missing.length > 0 || !adapter) {
      const reason = !adapter ? '平台适配器尚未就绪' : `未配置访问密钥：${missing.join('、')}`
      context.log('modelbay-mcp: 调用被拒绝', { tool: name, reason })
      return errorResult(`${reason}，工具 ${name} 无法调用。请在环境变量中配置后重试。`)
    }

    if (route.kind === 'native') {
      if (adapter.native) {
        const value = await adapter.native(route.op, args, context)
        return result(value)
      }
      // 适配器未实现 native()：退化成带 native 字段的 submit，仍按契约路由。
      const request = {
        capability: fallbackCapability,
        model: '',
        input: {},
        native: { op: route.op, params: args },
      } as unknown as AdapterRequest
      const value = await adapter.submit(request, context)
      return result(value)
    }

    const input: Record<string, unknown> = { ...args }
    delete input.model
    const model = typeof args.model === 'string' ? args.model : derivedDefaultModel(tool)
    const request = {
      capability: route.capability,
      model,
      input,
    } as unknown as AdapterRequest
    const value = await adapter.submit(request, context)
    return result(value)
  }

  return {
    serverInfo,
    listTools: () => listTools(set, groups),
    callTool,
  }
}
