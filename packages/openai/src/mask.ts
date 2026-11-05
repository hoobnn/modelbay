/**
 * 蒙版转换的公共类型（运行时无关）。
 *
 * 白色表示要重绘的区域；OpenAI 的 `/images/edits` 要的是 RGBA alpha 蒙版
 * （透明处才重绘），所以真正的转换要靠 Node 子路径里的 sharp。
 * 根入口只声明注入点，不 import sharp。
 */
import type { AdapterContext } from '@modelbay/core'

/** 一张图片的字节与 MIME。 */
export interface ImageBytes {
  data: Uint8Array
  mime: string
}

/** 转换结果：摆正后的原图 PNG + 反转 alpha 的蒙版 PNG。 */
export interface PreparedEdit {
  original: ImageBytes
  mask: ImageBytes
  width: number
  height: number
}

/** 转换的输入：原图与「白色重绘」的蒙版。 */
export interface EditMaskInput {
  source: ImageBytes
  mask: ImageBytes
}

/**
 * 适配器注入点：把白色重绘蒙版转成 OpenAI 认的 alpha 蒙版。
 *
 * 第一个参数是本次请求的上下文，实现从这里读配置与密钥。
 */
export type EditMaskPreparer = (ctx: AdapterContext, input: EditMaskInput) => Promise<PreparedEdit>

/** 适配器工厂的选项：Node 专属能力由宿主注入，根入口保持运行时无关。 */
export interface OpenAIAdapterOptions {
  /**
   * 蒙版转换实现（Node 子路径 `@modelbay/openai/node` 提供）。
   *
   * 没注入时 `image.edit` 报 `invalid_input`，不会原样发出语义相反的蒙版。
   */
  editMask?: EditMaskPreparer
}
