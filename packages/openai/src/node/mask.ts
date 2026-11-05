/**
 * Node-only image-edit helpers, exported from `@modelbay/openai/node`.
 * The root entry never imports this file: the real mask inversion needs `sharp`,
 * which is Node-only and is installed by the integrator.
 *
 * 蒙版约定（沿用 plein）：白色区域表示要重绘的部分，黑色区域保持不变。
 * OpenAI 的 `/images/edits` 要求蒙版是 RGBA PNG，透明处才重绘，
 * 所以这里把亮度反转成 alpha：白 → 透明（重绘），黑 → 不透明（保留）。
 */
import {
  ProviderError,
  selectDefaultModel,
  toBase64,
  type AdapterContext,
  type AssetRef,
} from '@modelbay/core'
import { all as allModels } from '../models/index'
import { editRequestBody } from '../media'
import type { EditMaskPreparer, ImageBytes, PreparedEdit } from '../mask'
import type { Json } from '../http'

export type { EditMaskInput, EditMaskPreparer, ImageBytes, PreparedEdit } from '../mask'

export interface MaskInput {
  data: Uint8Array
  mime: string
  width: number
  height: number
}

/** Original image and mask must have identical dimensions. */
export function assertSameSize(source: MaskInput, mask: MaskInput): void {
  if (source.width !== mask.width || source.height !== mask.height)
    throw new ProviderError('invalid_input', '蒙版与原图尺寸不一致')
}

/**
 * 载入 `sharp`。
 *
 * `sharp` 是 Node 专属依赖（Apache-2.0），由集成方安装；没装时给出明确的错误。
 */
async function loadSharp(): Promise<(typeof import('sharp'))['default']> {
  try {
    const mod = await import('sharp')
    return mod.default
  } catch (cause) {
    throw new ProviderError('unavailable', '蒙版处理需要安装 sharp（Apache-2.0，Node 专属依赖）', {
      cause,
    })
  }
}

/**
 * 把「白色重绘」的蒙版转成 OpenAI 认的 RGBA alpha 蒙版。
 *
 * - 原图按 EXIF 方向摆正并统一转 PNG；
 * - 蒙版去 alpha 后转灰度，亮度反转成 alpha：白 → 透明（重绘），黑 → 不透明（保留）；
 * - 原图与蒙版尺寸不一致时直接报错。
 */
export async function prepareEditMask(source: ImageBytes, mask: ImageBytes): Promise<PreparedEdit> {
  const sharp = await loadSharp()
  let original: { data: Buffer; info: { width?: number; height?: number } }
  let gray: { data: Buffer; info: { width?: number; height?: number } }
  try {
    original = await sharp(source.data).rotate().png().toBuffer({ resolveWithObject: true })
    gray = await sharp(mask.data)
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch (cause) {
    throw new ProviderError('invalid_input', '原图或蒙版无法解析，请提供 PNG 或 JPEG 图片', {
      cause,
    })
  }
  const width = gray.info.width ?? 0
  const height = gray.info.height ?? 0
  if (!width || !height) throw new ProviderError('invalid_input', '蒙版尺寸无法识别')
  if (original.info.width !== width || original.info.height !== height)
    throw new ProviderError('invalid_input', '蒙版与原图尺寸不一致')
  const alpha = Buffer.from(gray.data.map((value) => 255 - value))
  const converted = await sharp({
    create: { width, height, channels: 3, background: 'white' },
  })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
  return {
    original: { data: new Uint8Array(original.data), mime: 'image/png' },
    mask: { data: new Uint8Array(converted), mime: 'image/png' },
    width,
    height,
  }
}

export interface EditRequestOptions {
  /** 不传时取声明里的 `image.edit` 默认模型。 */
  model?: string
  prompt: string
  /** 原图。 */
  image: AssetRef
  /** 蒙版；白色区域重绘。 */
  mask: AssetRef
  count?: number
}

/**
 * 注入点实现：把白色重绘蒙版转成 alpha 蒙版。
 *
 * 宿主这样注入：`createOpenAIAdapter(models, { editMask })`。
 * 转换本身是纯字节处理，`ctx` 目前用不到，但签名与其它平台的注入点一致。
 */
export const editMask: EditMaskPreparer = async (_ctx, { source, mask }) =>
  prepareEditMask(source, mask)

/** 把字节变成 data URL。 */
function dataUrl(image: ImageBytes): string {
  return `data:${image.mime};base64,${toBase64(image.data)}`
}

/**
 * 端到端准备 `/images/edits` 的请求体：读原图与蒙版 → 转换蒙版 → 拼请求体。
 *
 * 根入口的 `image.edit` 路径只做 JSON 拼装（运行时无关），蒙版的 alpha 反转在
 * 这个 Node 子路径里做；宿主要用白色重绘语义就得走这里。
 */
export async function prepareImageEditRequest(
  ctx: AdapterContext,
  opts: EditRequestOptions,
): Promise<Json> {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for editing')
  if (!opts.prompt.trim()) throw new ProviderError('invalid_input', 'Image edit prompt is required')
  const [source, rawMask] = await Promise.all([
    ctx.assets.load(opts.image.assetId),
    ctx.assets.load(opts.mask.assetId),
  ])
  const prepared = await prepareEditMask(
    { data: source.data, mime: source.mime || opts.image.mime || 'image/png' },
    { data: rawMask.data, mime: rawMask.mime || opts.mask.mime || 'image/png' },
  )
  const model = opts.model ?? selectDefaultModel(allModels, 'image.edit', 'openai')?.channel.id
  if (!model)
    throw new ProviderError('invalid_input', '没有 image.edit 的默认模型，请显式指定 model')
  return editRequestBody({
    model,
    prompt: opts.prompt,
    count: opts.count ?? 1,
    source: dataUrl(prepared.original),
    mask: dataUrl(prepared.mask),
  })
}
