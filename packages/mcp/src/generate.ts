/** 从 ModelDeclaration + 适配器 + 工具目录生成 MCP 工具集合。 */
import type {
  ModelDeclaration,
  PlatformAdapter,
  PlatformDescriptor,
  ToolSpec,
} from '@modelbay/core'
import { findPlatform } from 'modelbay'
import {
  deriveAnnotations,
  deriveDefaultNote,
  deriveInputSchema,
  deriveToolDescription,
} from './derive'
import { deriveMeta, EXTRA_TOOL_NAMES } from './tool-meta'
import type { GeneratedTool, GeneratedToolSet, MCPTool, ToolGroup, ToolRoute } from './types'

export interface GenerateOptions {
  /** 平台适配器：提供 models 与 nodeOnly；缺省时用空声明集合（tools/list 仍可用）。 */
  adapter?: PlatformAdapter
  /** 直接给声明（测试构造伪造声明时用）。优先于 adapter.models。 */
  models?: readonly ModelDeclaration[]
}

/** 去掉内部字段，得到 MCP tools/list 的公开工具形状。 */
export function toMCPTool(tool: GeneratedTool): MCPTool {
  const { name, description, inputSchema, outputSchema, annotations } = tool
  return {
    name,
    description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    annotations,
  }
}

/** 按启用的工具组过滤（MCP_TOOL_GROUPS 开关）。 */
export function listTools(set: GeneratedToolSet, groups: readonly ToolGroup[]): MCPTool[] {
  return set.all.filter((tool) => groups.includes(tool.group)).map(toMCPTool)
}

/** 生成全量工具（含所有组与别名）；实际 tools/list 由 listTools 按组过滤。 */
export function generateTools(
  target: PlatformDescriptor | string,
  options: GenerateOptions = {},
): GeneratedToolSet {
  const platform = typeof target === 'string' ? findPlatform(target) : target
  if (!platform?.mcp) throw new Error(`平台「${String(target)}」没有 MCP 工具目录`)
  const models: readonly ModelDeclaration[] = options.models ?? options.adapter?.models ?? []
  const nodeOnly = new Set(options.adapter?.nodeOnly ?? [])
  const capabilities = models.flatMap((model) => model.capabilities)
  // 兜底能力仅用于派生无明确能力映射的工具；不是模型参数/上下限/默认值/生命周期。
  const defaultCapability = capabilities[0] ?? 'text.chat'
  // 深拷贝，生成过程不改动平台包里的工具定义
  const entries = structuredClone(platform.mcp.tools)

  const all: GeneratedTool[] = []
  for (const entry of entries) {
    all.push(...buildTool(entry, platform.primaryChannel, models, defaultCapability, nodeOnly))
  }
  for (const name of EXTRA_TOOL_NAMES) {
    all.push(buildExtraTool(name))
  }

  const routes = new Map<string, ToolRoute>()
  const byName = new Map<string, GeneratedTool>()
  for (const tool of all) {
    routes.set(tool.name, tool.route)
    byName.set(tool.name, tool)
  }
  return { platform: platform.key, all, routes, byName }
}

function buildTool(
  entry: ToolSpec,
  channel: string,
  models: readonly ModelDeclaration[],
  defaultCapability: string,
  nodeOnly: Set<string>,
): GeneratedTool[] {
  const meta = deriveMeta(entry.name)
  // 目录里写的能力优先；没写就用工具元数据映射的能力。
  const capability = entry.capability ?? meta.capability ?? defaultCapability
  const route = buildRoute(meta, capability)

  // nodeOnly 是适配器声明的可选 node: 子路径能力，强制归入可选组。
  const group: ToolGroup = route.kind === 'native' && nodeOnly.has(route.op) ? 'node' : meta.group

  const nativeOp = route.kind === 'native' ? route.op : undefined
  const inputSchema = deriveInputSchema(entry, models, capability, channel, nativeOp)
  const annotations = deriveAnnotations(meta.nature)
  // 工具说明里的模型清单与各模型上限由声明派生，改声明这段文字就跟着变。
  const note = deriveDefaultNote(entry, models, capability, channel, nativeOp)
  const description = `${deriveToolDescription(entry.description, models, capability)}${
    note ? `\n${note}\n` : ''
  }`

  const tool: GeneratedTool = {
    name: entry.name,
    description,
    inputSchema,
    ...(entry.outputSchema ? { outputSchema: structuredClone(entry.outputSchema) } : {}),
    annotations,
    group,
    route,
  }

  const result: GeneratedTool[] = [tool]
  for (const alias of entry.aliases ?? []) {
    result.push({
      ...structuredClone(tool),
      name: alias,
      description: `${description}\n（${entry.name} 的跨平台统一命名别名，保留兼容）`,
      aliasOf: entry.name,
    })
  }
  return result
}

function buildRoute(meta: ReturnType<typeof deriveMeta>, capability: string): ToolRoute {
  if (meta.localHandler) {
    return { kind: 'local', handler: meta.localHandler, nature: meta.nature }
  }
  if (meta.nativeOp) {
    return { kind: 'native', op: meta.nativeOp, nature: meta.nature }
  }
  return { kind: 'submit', capability, nature: meta.nature }
}

/** 超出基线的新工具：让客户端从声明派生可用模型与生命周期，不硬编码模型清单。 */
function buildExtraTool(name: string): GeneratedTool {
  return {
    name,
    description:
      '列出本平台声明的模型 ID、能力与生命周期提示（从 ModelDeclaration 派生），不联网、不计费。',
    inputSchema: {
      type: 'object',
      title: 'listDeclaredModelsArguments',
      properties: {
        capability: { type: 'string', description: '按归一化能力筛选（可选）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        models: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
    annotations: deriveAnnotations('local'),
    group: 'core',
    route: { kind: 'local', handler: 'models', nature: 'local' },
  }
}

/** 测试/文档用：返回某组启用时的工具名集合。 */
export function toolNames(set: GeneratedToolSet, groups: readonly ToolGroup[]): string[] {
  return listTools(set, groups).map((tool) => tool.name)
}
