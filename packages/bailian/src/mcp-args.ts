/**
 * MCP 工具参数的白名单透传。
 *
 * MCP 目录承诺的参数（`negative_prompt`、`prompt_extend`、`watermark`、`thinking`、
 * `parameters` 等）以平铺字段到达 `input`；按能力显式挑出白名单字段并进 `extra`，
 * 之后走与宿主相同的校验与白名单过滤。`extra` 里已有的同名键优先；
 * 白名单之外的平铺字段不处理（与宿主行为一致）。
 */
import type { Json } from './http'

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 目录里 null 表示“没填”，不并入。 */
function defined(source: Json, keys: readonly string[]): Json {
  const out: Json = {}
  for (const key of keys)
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  return out
}

/** 适配器自己构造的键：MCP 的 parameters 不能覆盖 */
const RESERVED = new Set([
  'model',
  'input',
  'messages',
  'prompt',
  'size',
  'n',
  'seed',
  'duration',
  'resolution',
  'ratio',
  'audio',
  'text',
  'voice',
])

/** 取出 MCP `parameters` 里可整体透传的键（图片、视频用）。 */
export function passthroughParameters(input: unknown): Json {
  const value = (input as Json | undefined)?.mcpParameters
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => !RESERVED.has(key)))
}

export function liftMcpArguments<T extends Json>(capability: string, model: string, input: T): T {
  const flat = input as Json
  const parameters = isObject(flat.parameters) ? flat.parameters : {}
  let lifted: Json = {}
  const patch: Json = {}
  if (capability === 'image.generate') {
    lifted = defined(flat, ['negative_prompt', 'prompt_extend', 'watermark', 'size'])
    if (flat.thinking !== undefined && flat.thinking !== null)
      lifted[model.startsWith('qwen-image-3.0') ? 'enable_thinking' : 'thinking_mode'] =
        flat.thinking
    if (flat.count === undefined && typeof flat.n === 'number') patch.count = flat.n
    patch.mcpParameters = parameters
  } else if (capability === 'video.generate') {
    lifted = defined(flat, ['prompt_extend', 'watermark'])
    if (flat.aspectRatio === undefined && typeof flat.ratio === 'string')
      patch.aspectRatio = flat.ratio
    patch.mcpParameters = parameters
  } else if (capability === 'audio.speech') {
    if (flat.instruction === undefined && typeof flat.instructions === 'string')
      patch.instruction = flat.instructions
  } else return input
  const extra = isObject(flat.extra) ? flat.extra : {}
  const merged = capability === 'audio.speech' ? { ...parameters } : {}
  return { ...input, ...patch, extra: { ...merged, ...lifted, ...extra } }
}
