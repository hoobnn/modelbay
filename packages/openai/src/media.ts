/**
 * OpenAI image request construction / response parsing and the `/models`
 * parser. Everything is JSON-based and uses only `ctx.fetch`; the sharp mask
 * inversion for `image.edit` lives in the optional `@modelbay/openai/node`
 * subpath.
 */
import {
  ProviderError,
  fromBase64,
  toBase64,
  type AdapterContext,
  type AssetRef,
  type CapabilityInput,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, type Json } from './http'
import { imageDataUrl } from './chat'
import type { EditMaskPreparer, ImageBytes } from './mask'

export { openAiModelList } from '@modelbay/shared'

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

/** 把字节变成 data URL。 */
function dataUrl(image: ImageBytes): string {
  return `data:${image.mime};base64,${toBase64(image.data)}`
}

/** Map a normalized aspect ratio (or explicit width/height) to the platform size. */
export function imageSize(input: CapabilityInput<'image.generate'>): string {
  if (input.width !== undefined || input.height !== undefined) {
    const w = input.width ?? 0
    const h = input.height ?? 0
    if (
      ![w, h].every((n) => Number.isInteger(n) && n > 0 && n <= 3840 && n % 16 === 0) ||
      w * h < 655360 ||
      w * h > 8294400 ||
      w / h < 1 / 3 ||
      w / h > 3
    )
      invalid('尺寸须为 16 的倍数、每边不超过 3840、总像素 655360–8294400、比例 1:3–3:1')
    return `${w}x${h}`
  }
  const sizes: Record<string, string> = {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1536x864',
    '9:16': '864x1536',
  }
  const ratio = String(input.extra?.aspectRatio ?? 'auto')
  if (ratio !== 'auto' && !sizes[ratio]) invalid('不支持所选画幅')
  return sizes[ratio] ?? 'auto'
}

const IMAGE_EXTRA = ['quality', 'background', 'output_format'] as const
const MAX_BYTES = 14 * 1024 * 1024

/** 只取声明里的图片参数；格式默认 PNG，JPEG 不能透明背景。 */
function imageOptions(extra: Json): { options: Json; format: string } {
  const options: Json = {}
  for (const key of IMAGE_EXTRA) {
    if (extra[key] !== undefined) options[key] = extra[key]
  }
  const format = String(options.output_format ?? 'png')
  if (!['png', 'jpeg', 'webp'].includes(format)) invalid('不支持的输出格式')
  if (format === 'jpeg' && options.background === 'transparent')
    invalid('透明背景须使用 PNG 或 WebP')
  return { options, format }
}

export interface BuiltImage {
  body: Json
  format: string
  edit: boolean
}

/** Build an `/images/generations` (or `/images/edits`) JSON body. */
export async function buildImageBody(
  model: string,
  input: CapabilityInput<'image.generate'>,
  ctx: AdapterContext,
  label: string,
): Promise<BuiltImage> {
  const { options, format } = imageOptions(asJson(input.extra ?? {}))

  const count = input.count ?? 1
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10 ||
    !input.prompt?.trim() ||
    input.prompt.length > 32000
  )
    invalid('图片提示词须为 1–32000 字符，数量须为 1–10')

  const body: Json = {
    ...options,
    model,
    prompt: input.prompt,
    n: count,
    output_format: format,
  }
  const references = input.references ?? []
  if (references.length > 16) invalid('最多支持 16 张参考图')
  if (references.length) {
    body.images = await Promise.all(
      references.map(async (ref) => ({ image_url: await imageDataUrl(ctx, ref, label) })),
    )
    return { body, format, edit: true }
  }
  body.size = imageSize(input)
  return { body, format, edit: false }
}

/** The `/images/edits` body, shared by the root path and the Node subpath. */
export function editRequestBody(opts: {
  model: string
  prompt: string
  count: number
  /** 画质 / 背景 / 输出格式；缺省只发 PNG。 */
  options?: Json
  format?: string
  /** Original image data URL. */
  source: string
  /** Mask data URL (RGBA PNG for OpenAI). */
  mask: string
}): Json {
  return {
    ...opts.options,
    model: opts.model,
    prompt: opts.prompt,
    n: opts.count,
    output_format: opts.format ?? 'png',
    images: [{ image_url: opts.source }],
    mask: { image_url: opts.mask },
  }
}

/**
 * Build an `/images/edits` body from the original image and mask data URLs.
 *
 * 蒙版语义：白色区域重绘、黑色区域保留；OpenAI 要的是 RGBA alpha 蒙版
 * （透明处才重绘），所以必须先经过注入的转换实现把亮度反转成 alpha。
 * 没注入时直接报错，绝不原样发出语义相反的蒙版。
 */
export async function buildEditBody(
  model: string,
  input: CapabilityInput<'image.edit'>,
  ctx: AdapterContext,
  label: string,
  editMask?: EditMaskPreparer,
): Promise<BuiltImage> {
  if (!input.image || !input.mask) invalid('请提供原图和蒙版')
  if (!editMask)
    invalid(
      `${label} 图片编辑需要把白色重绘蒙版转成 alpha 蒙版：请从 @modelbay/openai/node 引入 editMask，` +
        '再用 createOpenAIAdapter(models, { editMask }) 注入',
    )
  const { options, format } = imageOptions(asJson(input.extra ?? {}))
  const count = input.count ?? 1
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10 ||
    !input.prompt?.trim() ||
    input.prompt.length > 32000
  )
    invalid('图片提示词须为 1–32000 字符，数量须为 1–10')
  const [source, mask] = await Promise.all([
    readFile(ctx, input.image, label),
    readFile(ctx, input.mask, label),
  ])
  if (source.data.length > MAX_BYTES || mask.data.length > MAX_BYTES)
    invalid('原图或蒙版超过本地 14 MiB 限制')
  let prepared
  try {
    prepared = await editMask(ctx, {
      source: { data: source.data, mime: source.mime || input.image.mime || 'image/png' },
      mask: { data: mask.data, mime: mask.mime || input.mask.mime || 'image/png' },
    })
  } catch (cause) {
    if (cause instanceof ProviderError && cause.code !== 'invalid_input') throw cause
    throw new ProviderError(
      'invalid_input',
      `${label} 原图或蒙版无法读取、尺寸不一致或转换后过大`,
      {
        cause,
      },
    )
  }
  if (Math.max(prepared.original.data.length, prepared.mask.data.length) > MAX_BYTES)
    invalid(`${label} 原图或蒙版无法读取、尺寸不一致或转换后过大`)
  return {
    body: editRequestBody({
      model,
      prompt: input.prompt,
      count,
      options,
      format,
      source: dataUrl(prepared.original),
      mask: dataUrl(prepared.mask),
    }),
    format,
    edit: true,
  }
}

/** 读资产：优先宿主的 `ctx.files`，回退到 `assets`。 */
async function readFile(
  ctx: AdapterContext,
  ref: AssetRef,
  label: string,
): Promise<{ data: Uint8Array; mime: string }> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets) invalid(`${label} 图片编辑需要宿主注入 files 或 assets 才能读取原图与蒙版`)
  return ctx.assets.load(ref.assetId)
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function unknownImage(): ProviderError {
  return new ProviderError('unknown', 'OpenAI 图片响应无效，提交可能已计费，请勿直接重提', {
    outcome: 'unknown',
    retryable: false,
  })
}

/** Parse an image response (`data: [{ b64_json }]`) into file outputs. */
export function parseImageResponse(data: Json, format: string): SubmitResult {
  const items = Array.isArray(data.data) ? data.data : []
  if (!items.length) throw unknownImage()
  const outputs: ProviderOutput[] = items.map((item) => {
    const encoded = asJson(item).b64_json
    if (typeof encoded !== 'string' || !BASE64.test(encoded)) throw unknownImage()
    return {
      type: 'file',
      kind: 'image',
      mime: `image/${format}`,
      data: fromBase64(encoded),
    }
  })
  return { state: 'succeeded', outputs, usage: { images: outputs.length } }
}
