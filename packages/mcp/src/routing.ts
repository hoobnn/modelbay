/**
 * 把 tools/list 与 tools/call 接到生成器结果、PlatformAdapter 与 AdapterContext。
 * tools/call 按生成时记录的 route 分发：
 *   submit → adapter.submit；native → adapter.native；local → 本地只读回答。
 * 未配置 key / 适配器未就绪时返回清晰错误（isError 结果），绝不抛到 stdio 循环里。
 */
import { lifecycleNotice, missingSecrets, selectDefaultModel, toBase64 } from 'modelbay'
import type {
  AdapterContext,
  AdapterRequest,
  ModelDeclaration,
  PlatformAdapter,
  PlatformSecrets,
  PollResult,
  SubmitResult,
} from 'modelbay'
import { normalizeArguments } from './arguments'
import { listTools } from './generate'
import {
  JobRegistry,
  deliver,
  deliveredIntact,
  outputDirectory,
  pollUntil,
  settle,
  waitSeconds,
} from './jobs'
import type {
  CallToolContent,
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
  /** 平台的密钥要求；缺必填密钥时 tools/call 返回清晰错误。 */
  secrets: PlatformSecrets
  serverInfo: ServerInfo
  /** 未传 model 时在哪个渠道里选默认模型；缺省取适配器的第一个渠道。 */
  primaryChannel?: string
  /** 调用没给 `out_dir` / `output_directory` 时的输出目录；缺省不落盘。 */
  defaultOutDir?: string
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/**
 * 把结果里的字节（`Uint8Array`）拆成 MCP 标准内容块：图片 / 音频用 base64 的 image / audio 块，
 * 其他文件用内嵌资源。文本和结构化结果里只留 `bytes` 与内容块序号，不把字节序列化成 JSON。
 */
function splitBinary(value: unknown, blocks: CallToolContent[]): unknown {
  if (value instanceof Uint8Array) return { bytes: value.byteLength }
  if (Array.isArray(value)) return value.map((item) => splitBinary(item, blocks))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if (record.data instanceof Uint8Array) {
    const data = toBase64(record.data)
    const mimeType = typeof record.mime === 'string' ? record.mime : 'application/octet-stream'
    const kind = record.kind
    blocks.push(
      kind === 'image' || kind === 'audio'
        ? { type: kind, data, mimeType }
        : {
            type: 'resource',
            resource: {
              uri: `modelbay://output/${blocks.length}/${String(record.name ?? 'file')}`,
              mimeType,
              blob: data,
            },
          },
    )
    const { data: _bytes, ...rest } = record
    return { ...rest, bytes: record.data.byteLength, content: blocks.length }
  }
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, splitBinary(v, blocks)]))
}

function result(value: unknown): CallToolResult {
  const blocks: CallToolContent[] = []
  const plain = splitBinary(value, blocks)
  const structured =
    typeof plain === 'object' && plain !== null ? (plain as Record<string, unknown>) : undefined
  return {
    content: [{ type: 'text', text: toText(plain) }, ...blocks],
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

/**
 * 传给适配器的模型：工具没传 model 时按能力取声明里的默认模型（只认 active、只在主渠道里选），
 * 并统一去掉适配器自己渠道的 `渠道:` 前缀，适配器拿到的永远是渠道内 ID。
 * 其他渠道的前缀（如方舟 MCP 里的 `ark-plan:`）原样保留，让适配器的渠道校验照常生效。
 */
function modelFor(
  args: Record<string, unknown>,
  capability: string,
  adapter: PlatformAdapter,
  primaryChannel: string | undefined,
): string {
  const given = typeof args.model === 'string' ? args.model.trim() : ''
  if (given) return stripChannel(given, adapter.channels)
  const channel = primaryChannel ?? adapter.channels[0]
  const selected = selectDefaultModel(adapter.models, capability as never, channel)
  return selected?.channel.id ?? ''
}

function stripChannel(model: string, channels: readonly string[]): string {
  const colon = model.indexOf(':')
  if (colon < 0) return model
  return channels.includes(model.slice(0, colon)) ? model.slice(colon + 1) : model
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
  const { set, adapter, context, groups, secrets, serverInfo, primaryChannel, defaultOutDir } =
    options
  const models: readonly ModelDeclaration[] = adapter?.models ?? []
  const fallbackCapability = firstCapability(set)

  const jobs = new JobRegistry()

  /** 任务结果：交付文件（给了输出目录就落盘），异步任务带上 job_id / task_id。 */
  async function jobResult(
    tool: string,
    id: string | undefined,
    value: SubmitResult | PollResult,
    outDir: string | undefined,
  ): Promise<CallToolResult> {
    const ids = id ? { job_id: id, task_id: id } : {}
    const record = id ? jobs.get(id) : undefined
    if (value.state === 'pending') {
      return result({
        ...ids,
        job_state: 'running',
        completed: false,
        ...('progress' in value && value.progress !== undefined
          ? { progress: value.progress }
          : {}),
        ...(id ? { next: '用 get_job 查询进度，可传 wait（1–90 秒）等待完成' } : {}),
      })
    }
    if (value.state === 'failed') {
      if (record) record.state = 'failed'
      return {
        ...result({ ...ids, job_state: 'failed', completed: false, error: value.error }),
        isError: true,
      }
    }
    if (value.state !== 'succeeded' || !Array.isArray(value.outputs)) return result(value)
    const outputs = await deliver(value.outputs, outDir, tool, context)
    const payload = {
      ...ids,
      job_state: 'delivered',
      completed: true,
      outputs,
      ...(value.usage ? { usage: value.usage } : {}),
    }
    if (record) {
      record.state = 'delivered'
      if (outDir) record.delivered = { outDir, payload }
    }
    return result(payload)
  }

  function listJobs(args: Record<string, unknown>): CallToolResult {
    const limit = Number(args.limit ?? 20)
    return result({
      jobs: jobs.list(Number.isFinite(limit) && limit > 0 ? limit : 20),
      note: '只列出本进程提交的任务；任务记录不落盘，重启后用 task_id 调 get_job 仍可查询。',
    })
  }

  async function callJobs(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const id = [args.job_id, args.task_id].find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )
    if (!id) return errorResult(`${name} 需要 job_id 或 task_id`)
    if (
      typeof args.job_id === 'string' &&
      typeof args.task_id === 'string' &&
      args.job_id &&
      args.task_id &&
      args.job_id !== args.task_id
    )
      return errorResult('job_id 与 task_id 不属于同一任务')
    const record = jobs.get(id) ?? jobs.remember(id, name, undefined)
    const outDir = outputDirectory(args) ?? record.outDir ?? defaultOutDir
    // 已落盘到同一目录且文件都还完整：直接给上次的结果，不重复下载，上游链接过期也不影响。
    // 文件被删或不完整时照常查询并重新下载，recover_job 仍能恢复。
    if (
      record.delivered &&
      record.delivered.outDir === outDir &&
      (await deliveredIntact(record.delivered.payload))
    )
      return result(record.delivered.payload)
    const value = await pollUntil(adapter!, id, context, waitSeconds(args))
    return jobResult(record.tool, id, value, outDir)
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tool = set.byName.get(name)
    if (!tool) return errorResult(`未知工具 ${name}`)
    const route = tool.route

    if (route.kind === 'local' && (route.handler !== 'jobs' || name === 'list_jobs')) {
      return name === 'list_jobs' ? listJobs(args) : localResult(route.handler, args, set, models)
    }

    // 未配置 key：返回清晰错误而不是崩溃；log 走 stderr（由 context.log 决定是否输出）。
    const missing = missingSecrets(secrets, (name) => Boolean(context.secret(name)))
    if (missing.length > 0 || !adapter) {
      const reason = !adapter ? '平台适配器尚未就绪' : `未配置访问密钥：${missing.join('、')}`
      context.log('modelbay-mcp: 调用被拒绝', { tool: name, reason })
      return errorResult(`${reason}，工具 ${name} 无法调用。请在环境变量中配置后重试。`)
    }

    if (route.kind === 'local') return callJobs(name, args)

    // 工具 schema 里 `default: null` 表示「不指定」：null 不算传值，否则会被当成显式参数去校验
    const given = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null))

    if (route.kind === 'native') {
      const params = tool.mapArguments ? tool.mapArguments(given, { model: '' }) : given
      if (adapter.native) {
        const value = await adapter.native(route.op, params, context)
        return result(value)
      }
      // 适配器未实现 native()：退化成带 native 字段的 submit，仍按契约路由。
      const request = {
        capability: fallbackCapability,
        model: '',
        input: {},
        native: { op: route.op, params },
      } as unknown as AdapterRequest
      const value = await adapter.submit(request, context)
      return result(value)
    }

    const model = modelFor(args, route.capability, adapter, primaryChannel)
    const outDir = outputDirectory(given) ?? defaultOutDir
    const wait = waitSeconds(given)
    const mapped = tool.mapArguments ? tool.mapArguments(given, { model }) : given
    const input: Record<string, unknown> = normalizeArguments(route.capability, mapped)
    // 这几个由 MCP 层处理，不交给适配器
    for (const key of ['model', 'wait', 'out_dir', 'output_directory']) delete input[key]
    const request = {
      capability: route.capability,
      model,
      input,
    } as unknown as AdapterRequest
    const submitted = await adapter.submit(request, context)
    const id = submitted.state === 'pending' ? submitted.remoteId : undefined
    if (id) jobs.remember(id, name, outDir)
    return jobResult(name, id, await settle(adapter, submitted, context, wait), outDir)
  }

  return {
    serverInfo,
    listTools: () => listTools(set, groups),
    callTool,
  }
}
