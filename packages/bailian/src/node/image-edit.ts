/**
 * Node-only Bailian image editing (`@modelbay/bailian/image-edit`).
 *
 * This subpath is intentionally excluded from the root entry: the mask preprocessing
 * needs `sharp` (Apache-2.0, Node-only) and the reference upload needs the OSS
 * temporary storage. The request builder below is runtime-agnostic; the Node-only
 * helpers add the mask normalization and the upload on top of it.
 *
 * 官方对蒙版的要求（万相 2.1 通用图像编辑）：
 * - 分辨率必须与基准图一致，宽高在 512–4096 像素之间；
 * - 白色区域表示要编辑的部分，必须是纯白 RGB(255,255,255)；
 * - 黑色区域表示保持不变，必须是纯黑 RGB(0,0,0)；
 * - 格式支持 JPG / JPEG / PNG / BMP / TIFF / WEBP，大小不超过 10MB。
 */
import { ProviderError, type AdapterContext, type AssetRef } from '@modelbay/core'
import { IMAGE_EDIT_PATH, uploadAsset } from '../adapter'
import type { ImageEditPreparer, ImageProcessPreparer } from '../image-edit'
import type { Json } from '../http'

export { IMAGE_EDIT_PATH }
/** 官方要求的蒙版边长下限与上限（像素）。 */
export const MASK_MIN_SIDE = 512
export const MASK_MAX_SIDE = 4096
/** 官方要求的蒙版文件大小上限。 */
export const MASK_MAX_BYTES = 10 * 1024 * 1024

export interface ImageEditOptions {
  model?: string
  prompt: string
  /** Public URL or `oss://` address produced by the Node-only uploader. */
  baseImageUrl: string
  /** PNG mask, same dimensions as the source; white = repaint. */
  maskImageUrl: string
  count?: number
  seed?: number
  extra?: Record<string, unknown>
}

/** Build the `description_edit_with_mask` request body (no `node:` imports here). */
export function buildImageEditRequest(opts: ImageEditOptions): Record<string, unknown> {
  if (!opts.prompt.trim()) throw new ProviderError('invalid_input', 'Image edit prompt is required')
  if (!opts.baseImageUrl || !opts.maskImageUrl)
    throw new ProviderError('invalid_input', 'base_image_url and mask_image_url are required')
  return {
    model: opts.model ?? 'wanx2.1-imageedit',
    input: {
      function: 'description_edit_with_mask',
      prompt: opts.prompt,
      base_image_url: opts.baseImageUrl,
      mask_image_url: opts.maskImageUrl,
    },
    parameters: {
      ...opts.extra,
      n: opts.count ?? 1,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    },
  }
}

/** 一张待处理的图片（字节 + MIME）。 */
export interface ImageInput {
  data: Uint8Array
  mime: string
}

/** 处理后的蒙版。 */
export interface PreparedMask {
  /** 纯黑白（RGB）的 PNG 字节。 */
  data: Uint8Array
  mime: string
  width: number
  height: number
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
 * 把用户给的蒙版规范化成官方能识别的黑白图。
 *
 * - 按 EXIF 方向摆正，和基准图保持同一坐标系；
 * - 尺寸不一致时按基准图拉伸（官方要求分辨率必须一致）；
 * - 灰度后按阈值二值化，保证白色区域是纯白、黑色区域是纯黑；
 * - 输出 PNG，宽高必须在官方规定的 512–4096 像素之间。
 */
export async function prepareEditMask(base: ImageInput, mask: ImageInput): Promise<PreparedMask> {
  const sharp = await loadSharp()
  let baseMeta: { width?: number; height?: number }
  try {
    baseMeta = await sharp(base.data).rotate().metadata()
  } catch (cause) {
    throw new ProviderError('invalid_input', '基准图无法解析，请提供 PNG 或 JPEG 图片', { cause })
  }
  const width = baseMeta.width ?? 0
  const height = baseMeta.height ?? 0
  if (!width || !height) throw new ProviderError('invalid_input', '基准图尺寸无法识别')
  if (
    width < MASK_MIN_SIDE ||
    height < MASK_MIN_SIDE ||
    width > MASK_MAX_SIDE ||
    height > MASK_MAX_SIDE
  )
    throw new ProviderError(
      'invalid_input',
      `基准图宽高必须在 ${MASK_MIN_SIDE}-${MASK_MAX_SIDE} 像素之间`,
    )
  let data: Buffer
  try {
    data = await sharp(mask.data)
      .rotate()
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .threshold(128)
      .png()
      .toBuffer()
  } catch (cause) {
    throw new ProviderError('invalid_input', '蒙版无法解析，请提供 PNG 或 JPEG 图片', { cause })
  }
  if (data.length > MASK_MAX_BYTES)
    throw new ProviderError('invalid_input', '蒙版大小不能超过 10MB')
  return { data: new Uint8Array(data), mime: 'image/png', width, height }
}

export interface ImageEditAssetsOptions {
  /** 基准图。 */
  image: AssetRef
  /** 蒙版；白色区域重绘。 */
  mask: AssetRef
  prompt: string
  model?: string
  count?: number
  seed?: number
  extra?: Json
}

/**
 * 端到端准备局部重绘的请求体：处理蒙版 → 上传两张图 → 拼请求体。
 *
 * 上传走百炼的临时 OSS 存储（48 小时有效），返回 `oss://` 地址。
 * 宿主这样注入：`createBailianAdapter(models, { edit: prepareImageEditRequest })`。
 */
export const prepareImageEditRequest: ImageEditPreparer = async (ctx, opts) => {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for image editing')
  const model = opts.model ?? 'wanx2.1-imageedit'
  const [base, rawMask] = await Promise.all([
    ctx.assets.load(opts.image.assetId),
    ctx.assets.load(opts.mask.assetId),
  ])
  if (!base.data.length) throw new ProviderError('invalid_input', '基准图内容为空')
  const prepared = await prepareEditMask(
    { data: base.data, mime: base.mime || opts.image.mime || 'image/png' },
    { data: rawMask.data, mime: rawMask.mime || opts.mask.mime || 'image/png' },
  )
  const [baseUrl, maskUrl] = await Promise.all([
    uploadAsset(ctx, opts.image, model),
    uploadMask(ctx, opts.mask, prepared, model),
  ])
  return buildImageEditRequest({
    model,
    prompt: opts.prompt,
    baseImageUrl: baseUrl,
    maskImageUrl: maskUrl,
    ...(opts.count === undefined ? {} : { count: opts.count }),
    ...(opts.seed === undefined ? {} : { seed: opts.seed }),
    ...(opts.extra === undefined ? {} : { extra: opts.extra }),
  })
}

/**
 * 端到端准备精修的请求体：上传原图 → 拼请求体。
 *
 * AI 放大走 `super_resolution`，扩图走 `expand`；两者都是同一个
 * image-synthesis 端点，只是 `input.function` 与 `parameters` 不同。
 * 宿主这样注入：`createBailianAdapter(models, { process: prepareImageProcessRequest })`。
 */
export const prepareImageProcessRequest: ImageProcessPreparer = async (ctx, opts) => {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for image processing')
  const source = await ctx.assets.load(opts.image.assetId)
  if (!source.data.length) throw new ProviderError('invalid_input', '万相精修原图不能是空文件')
  const baseImageUrl = await uploadAsset(ctx, opts.image, opts.model)
  const parameters: Json = { n: 1, ...opts.extra }
  if (opts.operation === 'upscale') {
    parameters.upscale_factor = opts.scale ?? 2
  } else {
    const expansion = opts.expansion ?? { top: 1, bottom: 1, left: 1.5, right: 1.5 }
    parameters.top_scale = expansion.top
    parameters.bottom_scale = expansion.bottom
    parameters.left_scale = expansion.left
    parameters.right_scale = expansion.right
  }
  return {
    model: opts.model,
    input: {
      function: opts.operation === 'upscale' ? 'super_resolution' : 'expand',
      prompt: opts.prompt ?? '',
      base_image_url: baseImageUrl,
    },
    parameters,
  }
}

/** 把处理后的蒙版上传到百炼的临时 OSS 存储。 */
function uploadMask(
  ctx: AdapterContext,
  ref: AssetRef,
  prepared: PreparedMask,
  model: string,
): Promise<string> {
  return uploadAsset(ctx, { ...ref, mime: prepared.mime }, model, prepared.data)
}
