/**
 * MCP 工具参数的白名单透传。
 *
 * MCP 目录承诺的参数（`negative_prompt`、`prompt_extend`、`watermark`、`thinking`、
 * `parameters` 等）以平铺字段到达 `input`；按能力显式挑出白名单字段并进 `extra`，
 * 之后走与宿主相同的校验与白名单过滤。`extra` 里已有的同名键优先；
 * 白名单之外的平铺字段不处理（与宿主行为一致）。
 */
import { resolveModel } from '@modelbay/core'
import type { Json } from '../http'
import { all } from '../models/index'

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

/**
 * 以下是 `ToolSpec.mapArguments`：只服务 MCP，SDK 不经过。
 * 收到的参数已去掉 null；字段名按百炼官方文档换算。
 */
type Args = Record<string, unknown>

/** 渠道前缀与别名换成渠道内模型 ID；native 路由不经过 MCP 的模型解析。 */
function channelModel(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const given = value.trim()
  const bare = given.startsWith('bailian:') ? given.slice('bailian:'.length) : given
  return resolveModel(all, bare)?.channel.id ?? bare
}

/** 公网 URL / Data URI 原样给官方接口；本地路径换成素材引用，由宿主的素材来源读取。 */
function assetOrUrl(value: unknown, kind: 'audio' | 'image'): unknown {
  if (typeof value !== 'string' || /^(?:https?:\/\/|data:|oss:\/\/)/.test(value)) return value
  return { assetId: value, kind }
}

function withModel(args: Args): Args {
  const { model, ...rest } = args
  const id = channelModel(model)
  return id ? { ...rest, model: id } : rest
}

/**
 * chat：官方 OpenAI 兼容接口的非标准字段 enable_thinking / thinking_budget / enable_search
 * 与 `parameters` 一起进 `extra`，共享层把它们平铺到请求体顶层。
 * 来源：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions（2026-11-06 核对）
 * json_mode 对应 response_format={"type":"json_object"}：给一个宽松的对象 Schema，
 * 共享层按 json_object 模式发送，并把 Schema 写进系统提示（官方要求提示词里明确出现 JSON）。
 */
export function mapChatArguments(args: Args): Args {
  const extra: Args = { ...(isObject(args.parameters) ? args.parameters : {}) }
  if (typeof args.thinking === 'boolean') extra.enable_thinking = args.thinking
  if (typeof args.thinking_budget === 'number') extra.thinking_budget = args.thinking_budget
  if (typeof args.web_search === 'boolean') extra.enable_search = args.web_search
  const out: Args = { ...args, extra }
  if (args.json_mode === true) out.jsonSchema = { type: 'object' }
  return out
}

/** embed → native text-embed：文本与多模态向量化，参数名与 native 一致。 */
export const mapEmbedArguments = withModel

/** rerank → native rerank：query / documents / top_n / return_documents 与官方 text-rerank 一致。 */
export const mapRerankArguments = withModel

/**
 * speech_to_text → native asr（Qwen3-ASR-Flash 走 OpenAI 兼容接口，Qwen-Audio-ASR 3.1 走原生接口）。
 * 来源：https://help.aliyun.com/zh/model-studio/asr-model（2026-11-06 核对）：
 * 输入可以是 URL / Base64；本地路径在这里换成素材引用，由 native 读成 Data URI。
 * itn 默认关闭（与工具说明一致）。
 */
export function mapTranscribeArguments(args: Args): Args {
  return { ...withModel(args), audio: assetOrUrl(args.audio, 'audio'), itn: args.itn === true }
}

/**
 * transcribe_file → native asr-filetrans：本地路径换成素材引用，由适配器上传成 oss:// 临时地址。
 * 来源：https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api（2026-11-11 核对）。
 */
export function mapTranscribeFileArguments(args: Args): Args {
  return { ...withModel(args), audio: assetOrUrl(args.audio, 'audio') }
}

/** generate_audio → native audio-generation：参考音频的本地路径换成素材引用，由适配器读成 Data URI。 */
export function mapGenerateAudioArguments(args: Args): Args {
  const out = withModel(args)
  if (Array.isArray(args.references))
    out.references = args.references.map((item) => assetOrUrl(item, 'audio'))
  return out
}

/** clone_voice → native voice-clone：旧别名 url 并入 audio，本地路径换成素材引用。 */
export function mapCloneArguments(args: Args): Args {
  const { url, ...rest } = args
  const out: Args = { ...rest, audio: assetOrUrl(args.audio ?? url, 'audio') }
  const target = channelModel(args.target_model)
  if (target) out.target_model = target
  return out
}

/** design_voice → native voice-design：字段名一致，只规整 target_model。 */
export function mapDesignArguments(args: Args): Args {
  const out: Args = { ...args }
  const target = channelModel(args.target_model)
  if (target) out.target_model = target
  return out
}

/**
 * animate_portrait → native digital-human-lipsync：image / audio 对应官方 input.image_url / audio_url。
 * 来源：https://help.aliyun.com/zh/model-studio/wan2-2-s2v（2026-11-06 核对）。
 * 数字人接口只收公网 URL，本地文件不会被上传。
 */
export function mapPortraitArguments(args: Args): Args {
  const { image, audio, ...rest } = args
  return { ...rest, image_url: image, audio_url: audio }
}

/**
 * edit_video → native edit-video：video 须是公网 URL；参考图可以是公网 URL 或 Base64 Data URI，
 * 本地路径不会被上传。来源：https://help.aliyun.com/en/model-studio/happyhorse-video-edit-api-reference（2026-11-06 核对）。
 */
export function mapEditVideoArguments(args: Args): Args {
  return withModel(args)
}
