/**
 * `modelbay/node` — 加载各平台 `@modelbay/<平台>/node` 子路径里的 Node 专属能力
 * （对象存储上传、`sharp` 蒙版处理、WebSocket 流式识别等），注入适配器。
 *
 * 根入口保持运行时无关；只有 Node 宿主（MCP、CLI）才引入本模块。
 */
import type { PlatformAdapter, PlatformDescriptor } from '@modelbay/core'
import { PLATFORMS } from './platforms'

type NodeModule = { nodeOptions?: object }

/** 有 Node 扩展的平台。静态写出导入路径，打包器才能解析。 */
const NODE_LOADERS: Readonly<Record<string, () => Promise<NodeModule>>> = {
  ark: () => import('@modelbay/ark/node'),
  bailian: () => import('@modelbay/bailian/node'),
  'doubao-speech': () => import('@modelbay/doubao-speech/node'),
  openai: () => import('@modelbay/openai/node'),
}

/**
 * 读取平台的 `nodeOptions`。加载失败（缺可选依赖等）时返回 undefined：
 * 适配器照常创建，用到对应能力时再报出明确的缺依赖错误。
 */
export async function loadNodeOptions(key: string): Promise<object | undefined> {
  const loader = NODE_LOADERS[key]
  if (!loader) return undefined
  try {
    return (await loader()).nodeOptions
  } catch {
    return undefined
  }
}

/** 创建注入了 Node 专属能力的适配器。 */
export async function createNodeAdapters(platform: PlatformDescriptor): Promise<PlatformAdapter[]> {
  return platform.createAdapters(await loadNodeOptions(platform.key))
}

/** 全部平台的 Node 版适配器，可直接传给 `createModelbay({ adapters })`。 */
export async function nodeAdapters(
  platforms: readonly PlatformDescriptor[] = PLATFORMS,
): Promise<PlatformAdapter[]> {
  const lists = await Promise.all(platforms.map(createNodeAdapters))
  return lists.flat()
}
