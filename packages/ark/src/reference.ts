/**
 * 参考视频上传的公共类型（运行时无关）。
 *
 * 根入口与 Node 子路径共用这一份定义：适配器只声明「需要上传」，
 * 具体怎么传（TOS / S3 兼容）由宿主注入的实现决定。
 */
import type { AdapterContext } from '@modelbay/core'

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
 * 字段名与 plein 的 `ReferenceStorage` 一致；`AdapterContext` 没有独立的
 * settings 槽，非密钥配置也走 `ctx.secret` 这一个通道。
 */
export const REFERENCE_STORAGE_KEYS = {
  storage: 'ARK_REFERENCE_STORAGE',
  endpoint: 'ARK_REFERENCE_ENDPOINT',
  pathStyle: 'ARK_REFERENCE_PATH_STYLE',
  bucket: 'ARK_REFERENCE_BUCKET',
  region: 'ARK_REFERENCE_REGION',
} as const

/** 适配器工厂的选项：Node 专属能力由宿主注入，根入口保持运行时无关。 */
export interface ArkAdapterOptions {
  /**
   * 参考视频上传实现。
   *
   * Node 子路径 `@modelbay/ark/tos` 导出 `uploadReferenceVideo`；
   * 没注入时 `video.generate` 遇到视频参考会报 `invalid_input`。
   */
  uploadVideo?: ReferenceVideoUploader
}
