/**
 * OpenAI image request construction / response parsing and the `/models`
 * parser. Everything is JSON-based and uses only `ctx.fetch`; the sharp mask
 * inversion for `image.edit` is a documented Node-subpath TODO.
 */
import {
  ProviderError,
  fromBase64,
  type AdapterContext,
  type CapabilityInput,
  type ProviderOutput,
  type RemoteModel,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, type Json } from './http'
import { imageDataUrl } from './chat'

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
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
  const extra = asJson(input.extra ?? {})
  const options: Json = {}
  for (const key of IMAGE_EXTRA) {
    if (extra[key] !== undefined) options[key] = extra[key]
  }
  const format = String(options.output_format ?? 'png')
  if (!['png', 'jpeg', 'webp'].includes(format)) invalid('不支持的输出格式')
  if (format === 'jpeg' && options.background === 'transparent')
    invalid('透明背景须使用 PNG 或 WebP')

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

/** Build an `/images/edits` body from the original image and mask data URLs. */
export async function buildEditBody(
  model: string,
  input: CapabilityInput<'image.edit'>,
  ctx: AdapterContext,
  label: string,
): Promise<BuiltImage> {
  if (!input.image || !input.mask) invalid('请提供原图和蒙版')
  const format = 'png'
  const [source, mask] = await Promise.all([
    imageDataUrl(ctx, input.image, label),
    imageDataUrl(ctx, input.mask, label),
  ])
  return {
    body: {
      model,
      prompt: input.prompt ?? '',
      n: input.count ?? 1,
      output_format: format,
      images: [{ image_url: source }],
      mask: { image_url: mask },
    },
    format,
    edit: true,
  }
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Parse an image response (`data: [{ b64_json }]`) into file outputs. */
export function parseImageResponse(data: Json, format: string): SubmitResult {
  const items = Array.isArray(data.data) ? data.data : []
  if (!items.length) throw new ProviderError('unknown', 'OpenAI 图片响应无效；请勿直接重提')
  const outputs: ProviderOutput[] = items.map((item) => {
    const encoded = asJson(item).b64_json
    if (typeof encoded !== 'string' || !BASE64.test(encoded))
      throw new ProviderError('unknown', 'OpenAI 图片响应无效；请勿直接重提')
    return {
      type: 'file',
      kind: 'image',
      mime: `image/${format}`,
      data: fromBase64(encoded),
    }
  })
  return { state: 'succeeded', outputs, usage: { images: outputs.length } }
}

/** OpenAI-compatible model list: `{ data: [{ id, owned_by?, created? }] }`. */
export function openAiModelList(value: unknown): RemoteModel[] {
  const items = asJson(value).data
  if (!Array.isArray(items)) throw new ProviderError('unknown', '模型列表响应缺少 data 数组')
  return items.flatMap((item) => {
    const entry = asJson(item)
    if (typeof entry.id !== 'string' || !entry.id) return []
    return [
      {
        id: entry.id,
        ...(typeof entry.owned_by === 'string' && entry.owned_by
          ? { ownedBy: entry.owned_by }
          : {}),
        ...(typeof entry.created === 'number' ? { created: entry.created } : {}),
      },
    ]
  })
}
