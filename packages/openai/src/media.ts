/**
 * OpenAI image request construction / response parsing and the `/models`
 * parser. Everything is JSON-based and uses only `ctx.fetch`; the sharp mask
 * inversion for `image.edit` lives in the optional `@modelbay/openai/node`
 * subpath.
 */
import {
  ProviderError,
  resolveModel,
  imageModelProblem,
  type ModelDeclaration,
  fromBase64,
  toBase64,
  type AdapterContext,
  type AssetRef,
  type CapabilityInput,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, type Json } from './http'
import { all } from './models/index'
import { optionDefault, validateOptions } from './options'
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
export function imageSize(
  input: CapabilityInput<'image.generate'>,
  declaration: ModelDeclaration | undefined,
): string {
  const extra = asJson(input.extra)
  const sizeSchema = asJson(asJson(declaration?.optionsSchema?.properties).size)
  const sizes = asJson(sizeSchema['x-aspectRatioSizes'])
  let size = String(extra.size ?? optionDefault(declaration, 'size') ?? 'auto')
  if (input.width !== undefined || input.height !== undefined) {
    const w = input.width,
      h = input.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || Number(w) <= 0 || Number(h) <= 0)
      invalid('自定义宽高须一起填写正整数')
    size = `${w}x${h}`
  } else if (
    extra.size === undefined &&
    extra.aspectRatio !== undefined &&
    extra.aspectRatio !== 'auto'
  ) {
    const mapped = sizes[String(extra.aspectRatio)]
    if (typeof mapped !== 'string') invalid('不支持所选画幅')
    size = mapped
  }
  if (size !== 'auto') {
    const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size)
    if (!match) invalid('尺寸须为 auto 或 WIDTHxHEIGHT')
    const width = Number(match[1]),
      height = Number(match[2])
    const multiple = Number(sizeSchema['x-multiple'])
    if (
      !Number.isSafeInteger(width * height) ||
      (multiple && (width % multiple || height % multiple))
    )
      invalid('尺寸不符合声明的倍数或整数范围')
    if (declaration) {
      const problem = imageModelProblem(
        { ...declaration, capabilities: ['image.generate'] },
        { width, height, options: { size } },
        input.references?.length ?? 0,
      )
      if (problem) invalid(problem)
    }
  }
  return size
}

// 本地 data URL 请求体预算，不是上游模型的文件大小限制。
const MAX_BYTES = 14 * 1024 * 1024

/** Validate declared options and protocol combinations before any asset/network work. */
function imageOptions(
  extra: Json,
  declaration: ModelDeclaration | undefined,
  edit: boolean,
  count: number,
): { options: Json; format: string } {
  validateOptions(declaration, extra)
  const properties = asJson(declaration?.optionsSchema?.properties)
  const keys = Object.keys(properties)
  if (declaration) {
    const unknown = Object.keys(extra).filter(
      (key) =>
        !keys.includes(key) &&
        !['aspectRatio', 'baseURL', 'stream', 'partial_images', 'prompt_rewriter'].includes(key),
    )
    if (unknown.length) invalid(`模型声明不支持参数：${unknown.join('、')}`)
  }
  const options = Object.fromEntries(
    Object.entries(extra).filter(
      ([key]) =>
        (declaration
          ? keys.includes(key)
          : !['aspectRatio', 'model', 'prompt', 'n', 'images', 'mask', 'baseURL'].includes(key)) &&
        key !== 'size',
    ),
  )
  const format = String(extra.output_format ?? optionDefault(declaration, 'output_format') ?? 'png')
  if (!['png', 'jpeg', 'webp', 'svg', 'gif'].includes(format)) invalid('不支持的输出格式')
  if (extra.background === 'transparent' && !['png', 'webp'].includes(format))
    invalid('透明背景须使用 PNG 或 WebP')
  if (extra.output_compression !== undefined && !['jpeg', 'webp'].includes(format))
    invalid('output_compression 只适用于 JPEG 或 WebP')
  if (edit && ['svg', 'gif'].includes(format))
    invalid('SVG / GIF 只支持无参考图的图片生成，不支持编辑')
  if (format === 'svg' && count !== 1) invalid('SVG 一次只能生成一张')
  if (
    format !== 'gif' &&
    (extra.frame_count !== undefined || extra.frame_duration_ms !== undefined)
  )
    invalid('帧数与帧间隔只适用于 GIF')
  if (format !== 'svg' && extra.svg !== undefined) invalid('svg 参数只适用于 SVG 输出')
  if (
    extra.stream !== undefined ||
    extra.partial_images !== undefined ||
    extra.prompt_rewriter !== undefined
  )
    invalid('归一化图片接口不支持 stream / partial_images / prompt_rewriter')
  if (extra.markup !== undefined) {
    if (!edit) invalid('markup 需要参考图')
    const markup = asJson(extra.markup)
    if (
      Object.keys(markup).length !== 1 ||
      Object.keys(markup).some((k) => !['file_id', 'image_url'].includes(k)) ||
      [markup.file_id, markup.image_url].filter((v) => typeof v === 'string' && v.length > 0)
        .length !== 1
    )
      invalid('markup 必须包含且只包含一个非空 file_id 或 image_url')
  }
  return { options, format }
}

function validateImageInput(
  input: { prompt: string; count?: number; references?: AssetRef[] },
  declaration?: ModelDeclaration,
): number {
  const count = input.count ?? 1
  if (!Number.isInteger(count) || count < 1 || !input.prompt?.trim())
    invalid('图片提示词不能为空，数量须为正整数')
  if (declaration?.limits?.count && count > declaration.limits.count.max)
    invalid('图片数量超过模型声明上限')
  if (
    declaration?.limits?.promptMaxLength &&
    input.prompt.length > declaration.limits.promptMaxLength
  )
    invalid('图片提示词超过模型声明上限')
  if (
    declaration?.limits?.references &&
    (input.references?.length ?? 0) > declaration.limits.references.max
  )
    invalid('参考图数量超过模型声明上限')
  return count
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
  declaration: ModelDeclaration | undefined = resolveModel(all, model)?.declaration,
): Promise<BuiltImage> {
  const count = validateImageInput(input, declaration)
  const references = input.references ?? []
  const { options, format } = imageOptions(
    asJson(input.extra),
    declaration,
    references.length > 0,
    count,
  )

  const body: Json = {
    ...options,
    model,
    prompt: input.prompt,
    n: count,
    output_format: format,
    size: imageSize(input, declaration),
  }
  if (references.length) {
    body.images = await Promise.all(
      references.map(async (ref) => ({ image_url: await imageDataUrl(ctx, ref, label) })),
    )
    return { body, format, edit: true }
  }
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
  declaration: ModelDeclaration | undefined = resolveModel(all, model)?.declaration,
): Promise<BuiltImage> {
  if (!input.image || !input.mask) invalid('请提供原图和蒙版')
  if (!editMask)
    invalid(
      `${label} 图片编辑需要把白色重绘蒙版转成 alpha 蒙版：请从 @modelbay/openai/node 引入 editMask，` +
        '再用 createOpenAIAdapter(models, { editMask }) 注入',
    )
  const count = validateImageInput(input, declaration)
  const { options, format } = imageOptions(asJson(input.extra), declaration, true, count)
  if (options.markup !== undefined) invalid('markup 与 mask 不能同时使用')
  if (input.image.kind !== 'image' || input.mask.kind !== 'image')
    invalid('原图和蒙版必须是图片资产')
  options.size = imageSize({ prompt: input.prompt, extra: input.extra }, declaration)
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
    if (typeof encoded !== 'string' || !encoded || !BASE64.test(encoded)) throw unknownImage()
    return {
      type: 'file',
      kind: 'image',
      mime: format === 'svg' ? 'image/svg+xml' : `image/${format}`,
      data: fromBase64(encoded),
    }
  })
  const usage = asJson(data.usage)
  const svgUsage = asJson(data.svg_usage)
  const tokens = (key: string) => {
    const values = [usage[key], svgUsage[key]].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    )
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined
  }
  return {
    state: 'succeeded',
    outputs,
    usage: {
      images: outputs.length,
      ...(tokens('input_tokens') !== undefined ? { inputTokens: tokens('input_tokens') } : {}),
      ...(tokens('output_tokens') !== undefined ? { outputTokens: tokens('output_tokens') } : {}),
    },
  }
}
