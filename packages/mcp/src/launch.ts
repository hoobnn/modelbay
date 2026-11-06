/**
 * 启动逻辑：从注册表找到平台、读取密钥、创建注入了 Node 扩展的适配器、生成工具、启动 stdio server。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { createAdapterContext, readSecrets } from 'modelbay'
import type { PlatformAdapter, PlatformDescriptor } from 'modelbay'
import { PLATFORMS, findPlatform } from 'modelbay'
import { createNodeAdapters } from 'modelbay/node'
import { createMcpAssetSource } from './assets'
import { generateTools, listTools } from './generate'
import { createHandlers } from './routing'
import { createServer } from './server'
import { attachStdioTransport } from './stdio-transport'
import {
  GROUP_ENV_VAR,
  OUT_DIR_ENV_VAR,
  MCP_TOOL_GROUPS,
  TOOL_GROUPS,
  type GeneratedToolSet,
  type ToolGroup,
} from './types'

/** 版本号以 package.json 为准（源码和 dist 都在包目录下一层），发版时不用改代码。 */
export const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

/** 有 MCP 工具目录的平台。 */
export function mcpPlatforms(): PlatformDescriptor[] {
  return PLATFORMS.filter((platform) => platform.mcp)
}

/** 按平台键查有 MCP 工具目录的平台；找不到时抛出带可选清单的错误。 */
export function resolvePlatform(key: string): PlatformDescriptor {
  const platform = findPlatform(key)
  if (platform?.mcp) return platform
  const keys = mcpPlatforms().map((item) => item.key)
  throw new Error(`未知的 MCP 平台「${key}」，可选：${keys.join('、')}`)
}

/**
 * 创建平台的适配器（注入 Node 专属能力），取服务主渠道的那一个。
 * 失败时返回 undefined：tools/list 照常可用，tools/call 返回「适配器未就绪」。
 */
export async function loadAdapter(
  platform: PlatformDescriptor,
): Promise<PlatformAdapter | undefined> {
  try {
    const adapters = await createNodeAdapters(platform)
    return (
      adapters.find((adapter) => adapter.channels.includes(platform.primaryChannel)) ?? adapters[0]
    )
  } catch (error) {
    process.stderr.write(
      `[modelbay-mcp ${platform.key}] 平台适配器暂不可用：${error instanceof Error ? error.message : String(error)}\n`,
    )
    return undefined
  }
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

/** `MODELBAY_MCP_OUT_DIR` → `<目录>/<平台>`；支持开头的 `~`，空值表示不落盘。 */
export function resolveOutDir(
  env: Record<string, string | undefined>,
  platformKey: string,
): string | undefined {
  const raw = env[OUT_DIR_ENV_VAR]?.trim()
  if (!raw) return undefined
  const home = env.HOME ?? homedir()
  const base = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw
  return join(resolve(base), platformKey)
}

export interface StartOptions {
  env?: Record<string, string | undefined>
  input?: Readable
  output?: Writable
  onError?: (error: unknown) => void
}

export interface StartedServer {
  detach: () => void
  set: GeneratedToolSet
  groups: ToolGroup[]
}

export async function startServer(key: string, options: StartOptions = {}): Promise<StartedServer> {
  const platform = resolvePlatform(key)
  const name = `modelbay-mcp ${platform.key}`
  const env = options.env ?? process.env
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  const adapter = await loadAdapter(platform)
  const secrets = readSecrets(platform.secrets, env)
  const context = createAdapterContext({
    secrets,
    assets: createMcpAssetSource(),
    log: (message, data) => {
      process.stderr.write(`[${name}] ${message} ${JSON.stringify(data ?? {})}\n`)
    },
  })
  const groups = resolveGroups(env)
  const set = generateTools(platform, adapter ? { adapter } : {})
  const handlers = createHandlers({
    set,
    adapter,
    context,
    groups,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    defaultOutDir: resolveOutDir(env, platform.key),
    serverInfo: { name: `modelbay-mcp-${platform.key}`, version: VERSION },
  })
  const server = createServer(handlers)
  process.stderr.write(
    `[${name}] ready: ${listTools(set, groups).length}/${set.all.length} tools, groups=${groups.join(',')}, adapter=${adapter?.id ?? 'none'}\n`,
  )
  const detach = attachStdioTransport(server, input, output, {
    onError: options.onError ?? ((error) => process.stderr.write(`[${name}] ${String(error)}\n`)),
  })
  return { detach, set, groups }
}
