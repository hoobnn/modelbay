/**
 * 参考视频上传的公共类型（运行时无关）。
 *
 * 根入口与 Node 子路径共用这一份定义：适配器只声明「需要上传」，
 * 具体怎么传（TOS / S3 兼容）由宿主注入的实现决定。
 */
import type { AdapterContext, CapabilityInput, RemoteModel, SubmitResult } from '@modelbay/core'

/** 一份待上传的参考视频（字节 + MIME）。 */
export interface ReferenceFile {
  data: Uint8Array
  mime: string
}

/**
 * 适配器注入点：上传一份参考视频，返回下游可访问的限时地址。
 *
 * 第一个参数是本次请求的上下文，实现从这里读存储配置与密钥；
 * 这样适配器本身不需要知道对象存储的细节，上传也能跟着本次请求的取消信号走。
 */
export type ReferenceVideoUploader = (ctx: AdapterContext, file: ReferenceFile) => Promise<string>

/**
 * 参考视频存储配置在宿主配置里的键名。
 *
 * 宿主给了 `ctx.settings` 时直接读同名字段（`referenceStorage` / `referenceBucket` ...，
 * 另有可选的 `referenceKeyPrefix`）；没有 settings（MCP / CLI）时回退到这些 env / secret 名。
 */
export const REFERENCE_STORAGE_KEYS = {
  storage: 'ARK_REFERENCE_STORAGE',
  endpoint: 'ARK_REFERENCE_ENDPOINT',
  pathStyle: 'ARK_REFERENCE_PATH_STYLE',
  bucket: 'ARK_REFERENCE_BUCKET',
  region: 'ARK_REFERENCE_REGION',
  keyPrefix: 'ARK_REFERENCE_KEY_PREFIX',
} as const

/** 套餐语音识别：读 `input.audio`，经 `ctx.socket` 流式识别（Node 子路径提供实现）。 */
export type PlanTranscriber = (
  input: CapabilityInput<'audio.transcribe'>,
  ctx: AdapterContext,
) => Promise<SubmitResult>

/** 套餐模型目录：AK/SK 签名的管控面查询（Node 子路径提供实现）。 */
export type PlanDirectory = (ctx: AdapterContext) => Promise<RemoteModel[]>

/** 适配器工厂的选项：Node 专属能力由宿主注入，根入口保持运行时无关。 */
export interface ArkAdapterOptions {
  /**
   * 参考视频上传实现。
   *
   * Node 子路径 `@modelbay/ark/tos` 导出 `uploadReferenceVideo`；
   * 没注入时 `video.generate` 遇到视频参考会报 `invalid_input`。
   */
  uploadVideo?: ReferenceVideoUploader
  /**
   * 套餐语音识别实现（`audio.transcribe`，仅套餐渠道）。
   * Node 子路径导出 `transcribePlanAudio`；没注入时报 `unavailable`。
   */
  transcribePlan?: PlanTranscriber
  /**
   * 套餐模型目录实现（`native('listModels')`，仅套餐渠道）。
   * Node 子路径导出 `listPlanModels`；没注入时报 `unavailable`。
   */
  listPlanModels?: PlanDirectory
}
