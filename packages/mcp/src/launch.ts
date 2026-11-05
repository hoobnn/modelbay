/**
 * bin 入口的公共启动逻辑：读取环境变量里的 key、构造 AdapterContext、生成工具、启动 stdio server。
 * 适配器用动态 import 加载：并行开发阶段平台包可能还没导出适配器，回退后 tools/list 仍可用，
 * tools/call 返回「适配器未就绪 / 未配置密钥」的清晰错误而不是崩溃。
 */
import type { Readable, Writable } from 'node:stream'
import { createAdapterContext } from '@modelbay/core'
import type { PlatformAdapter } from '@modelbay/core'
import { GROUP_ENV_VAR, PLATFORMS, type PlatformMeta } from './platform'
import { generateTools } from './generate'
import { createHandlers } from './routing'
import { createServer } from './server'
import { attachStdioTransport } from './stdio-transport'
import {
  MCP_TOOL_GROUPS,
  TOOL_GROUPS,
  type GeneratedToolSet,
  type PlatformKey,
  type ToolGroup,
} from './types'

const VERSION = '0.1.0'

function isPlatformAdapter(value: unknown): value is PlatformAdapter {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.models) &&
    typeof candidate.submit === 'function'
  )
}

/**
 * Node 子路径的静态导入表。
 *
 * 子路径里的实现要 Node 专属依赖（ws 等），根入口保持运行时无关；
 * 这里用静态 import，打包器与测试的 alias 都能解析到。
 */
const NODE_NATIVE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
  'doubao-speech:interpretation': () => import('@modelbay/doubao-speech/interpretation'),
  'doubao-speech:asr': () => import('@modelbay/doubao-speech/asr'),
}

/** 动态加载平台适配器；variable specifier 让未构建的包在整合前不产生类型/解析错误。 */
export async function loadAdapter(platform: PlatformKey): Promise<PlatformAdapter | undefined> {
  const meta = PLATFORMS[platform]
  const packageName: string = `@modelbay/${platform}`
  try {
    const mod = (await import(/* @vite-ignore */ packageName)) as Record<string, unknown>
    const candidate = mod[meta.adapterExport] ?? mod.default
    if (!isPlatformAdapter(candidate)) return undefined
    // Node 子路径里的 native 实现：加载后注入适配器（根入口保持运行时无关）。
    const options = await loadNodeNatives(platform)
    if (options) {
      const factory = mod[options.factory]
      if (typeof factory === 'function')
        return (factory as (models: unknown, options: unknown) => PlatformAdapter)(
          candidate.models,
          options.options,
        )
    }
    return candidate
  } catch (error) {
    process.stderr.write(
      `[${meta.command}] 平台适配器暂不可用：${error instanceof Error ? error.message : String(error)}\n`,
    )
    return undefined
  }
}

/**
 * 加载 Node 子路径里的 native 实现，组装成适配器工厂的选项。
 *
 * 同一个包可能有多个子路径（豆包语音的同传与流式识别），逐个加载后合并选项。
 */
async function loadNodeNatives(
  platform: PlatformKey,
): Promise<{ factory: string; options: Record<string, unknown> } | undefined> {
  const specs = PLATFORMS[platform].nodeNatives
  if (!specs?.length) return undefined
  const options: Record<string, unknown> = {}
  let factory: string | undefined
  for (const spec of specs) {
    const loader = NODE_NATIVE_LOADERS[`${platform}:${spec.subpath}`]
    if (!loader) continue
    const nodeModule = (await loader().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined
    const runner = nodeModule?.[spec.export]
    if (typeof runner !== 'function') continue
    options[spec.option] = runner
    // 多个子路径属于同一个包时，工厂是同一个。
    if (!factory) factory = spec.factory
  }
  if (!factory) return undefined
  return { factory, options }
}

export function resolveGroups(env: Record<string, string | undefined>): ToolGroup[] {
  const raw = env[GROUP_ENV_VAR]
  if (!raw) return [...MCP_TOOL_GROUPS.default]
  const groups = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is ToolGroup => (TOOL_GROUPS as readonly string[]).includes(value))
  return groups.length > 0 ? groups : [...MCP_TOOL_GROUPS.default]
}

export interface StartOptions {
  env?: Record<string, string | undefined>
  input?: Readable
  output?: Writable
  onError?: (error: unknown) => void
}

/**
 * 只按平台声明的规范名从环境里取 key，注入 createAdapterContext 的 secret(name)。
 * 规范名：ARK_API_KEY / MINIMAX_API_KEY / BAILIAN_API_KEY / DOUBAO_APP_ID + DOUBAO_ACCESS_TOKEN。
 */
export function collectSecrets(
  meta: PlatformMeta,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const key of meta.keyEnvVars) {
    const value = env[key]
    if (value) secrets[key] = value
  }
  return secrets
}

export interface StartedServer {
  detach: () => void
  set: GeneratedToolSet
  groups: ToolGroup[]
}

export async function startServer(
  platform: PlatformKey,
  options: StartOptions = {},
): Promise<StartedServer> {
  const meta = PLATFORMS[platform]
  const env = options.env ?? process.env
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  const adapter = await loadAdapter(platform)
  const secrets = collectSecrets(meta, env)
  const context = createAdapterContext({
    secrets,
    log: (message, data) => {
      process.stderr.write(`[${meta.command}] ${message} ${JSON.stringify(data ?? {})}\n`)
    },
  })
  const groups = resolveGroups(env)
  const set = generateTools(platform, adapter ? { adapter } : {})
  const handlers = createHandlers({
    set,
    adapter,
    context,
    groups,
    keyEnvVars: meta.keyEnvVars,
    serverInfo: { name: meta.command, version: VERSION },
  })
  const server = createServer(handlers)
  process.stderr.write(
    `[${meta.command}] ready: ${set.all.length} tools, groups=${groups.join(',')}, adapter=${adapter?.id ?? 'none'}\n`,
  )
  const detach = attachStdioTransport(server, input, output, {
    onError:
      options.onError ?? ((error) => process.stderr.write(`[${meta.command}] ${String(error)}\n`)),
  })
  return { detach, set, groups }
}
