/** image.generate：前置校验按模型声明，宽高按长边换算，人物参考与画风按官方参数映射。 */
import {
  imageModelProblem,
  ProviderError,
  type AdapterContext,
  type AdapterRequest,
  type ModelDeclaration,
  type ModelInfo,
  type SubmitResult,
} from '@modelbay/core'
import { sizeByLongEdge, tierEdge } from '@modelbay/shared'
import { asJson, arr, requestJson } from './http'
import { imageData } from './chat'
import { imageOptions, liveImageOptions } from './image-options'
import { optionSource, pickKeys, required } from './util'

export function modelInfo(spec: ModelDeclaration): ModelInfo {
  return {
    id: spec.id,
    title: spec.title,
    capabilities: spec.capabilities as ModelInfo['capabilities'],
    ...(spec.limits ? { limits: spec.limits } : {}),
  }
}

export async function image(
  request: AdapterRequest<'image.generate'>,
  model: string,
  spec: ModelDeclaration,
  ctx: AdapterContext,
): Promise<SubmitResult> {
  const input = normalizeImageInput(request.input)
  required(input.prompt, 1500, '图片提示词')
  if ((input.references?.length ?? 0) > 1)
    throw new ProviderError('invalid_input', 'MiniMax 图片仅支持一张人物参考图')
  const n = input.count ?? 1
  if (!Number.isInteger(n) || n < 1 || n > 9)
    throw new ProviderError('invalid_input', 'MiniMax 图片数量须为 1–9')
  // 反向提示词与自定义宽高以模型声明为准，宿主在运行前读的是同一份声明
  const info = modelInfo(spec)
  if (spec.limits?.negativePrompt === false && input.negativePrompt)
    throw new ProviderError(
      'invalid_input',
      `${spec.title} 不支持反向提示词，请把内容合并到提示词里`,
    )
  const issue = imageModelProblem(
    info,
    {
      ...input,
      resolution: input.width === undefined ? input.resolution : undefined,
      aspectRatio: input.width === undefined ? input.extra?.aspectRatio : undefined,
      options: input.extra,
    },
    input.references?.length ?? 0,
  )
  if (issue) throw new ProviderError('invalid_input', issue)
  const live = model === 'image-01-live'
  const parsed = (live ? liveImageOptions : imageOptions).safeParse(input.extra ?? {})
  if (!parsed.success) throw new ProviderError('invalid_input', 'MiniMax 图片专属参数无效')
  const options = parsed.data as ReturnType<typeof liveImageOptions.parse>
  const reference = input.references?.[0]
  // 分辨率档位按长边换算宽高（image-01 宽高 512–2048、8 的倍数），优先于 aspect_ratio
  let { width, height } = input
  if (input.resolution !== undefined && width === undefined && height === undefined) {
    const edge = tierEdge(input.resolution)
    if (model !== 'image-01' || !edge || edge > 2048)
      throw new ProviderError('invalid_input', '所选 MiniMax 图片模型不支持该分辨率')
    const aspect = input.extra?.aspectRatio
    ;({ width, height } = sizeByLongEdge(typeof aspect === 'string' ? aspect : '1:1', edge))
  }
  if ((width === undefined) !== (height === undefined))
    throw new ProviderError('invalid_input', '图片宽高须一起填写')
  const customSize = spec.limits?.customSize
  if (width !== undefined && height !== undefined) {
    if (!customSize) throw new ProviderError('invalid_input', `${spec.title} 不支持自定义宽高`)
    const ok = [width, height].every(
      (side) =>
        Number.isInteger(side) &&
        side >= customSize.min &&
        side <= customSize.max &&
        (customSize.multiple === undefined || side % customSize.multiple === 0),
    )
    if (!ok) {
      const step = customSize.multiple === undefined ? '' : ` 且为 ${customSize.multiple} 的倍数`
      throw new ProviderError(
        'invalid_input',
        `${spec.title} 宽高须为 ${customSize.min}–${customSize.max}${step}`,
      )
    }
  }
  const data = await requestJson(ctx, '/v1/image_generation', {
    model,
    prompt: input.prompt,
    n,
    seed: input.seed,
    aspect_ratio: width ? undefined : (input.extra?.aspectRatio ?? '1:1'),
    width,
    height,
    response_format: 'url',
    prompt_optimizer: options.prompt_optimizer,
    aigc_watermark: options.aigc_watermark,
    ...('style_type' in options && options.style_type
      ? { style: { style_type: options.style_type, style_weight: options.style_weight ?? 0.8 } }
      : {}),
    subject_reference: reference
      ? [{ type: 'character', image_file: await imageData(ctx, reference, 10) }]
      : undefined,
  })
  const urls = arr(asJson(data.data).image_urls).filter(
    (url): url is string => typeof url === 'string' && /^https?:\/\//.test(url),
  )
  if (!urls.length) throw new ProviderError('unknown', 'MiniMax 响应缺少图片', { retryable: false })
  if (urls.length < n)
    ctx.log('MiniMax 仅生成部分图片，不自动重试', { requested: n, received: urls.length })
  return {
    state: 'succeeded',
    outputs: urls.map((url) => ({ type: 'file', kind: 'image', mime: 'image/jpeg', url })),
    usage: { images: urls.length },
  }
}

const IMAGE_KEYS = [
  'prompt_optimizer',
  'aigc_watermark',
  'style_type',
  'style_weight',
  'aspectRatio',
  'seed',
] as const

/**
 * MCP generate_image 的参数位置：顶层 aspect_ratio / n / prompt_optimizer，
 * parameters 里的 style 对象、seed、aigc_watermark；宿主放在 extra。
 * 只取白名单键，其余字段不进入 extra。
 */
function normalizeImageInput(
  input: AdapterRequest<'image.generate'>['input'],
): AdapterRequest<'image.generate'>['input'] {
  const source = optionSource(input)
  const style = source.style
  const flat = {
    ...(style && typeof style === 'object' ? (style as Record<string, unknown>) : {}),
    ...source,
    aspectRatio: source.aspectRatio ?? source.aspect_ratio,
  }
  const picked = pickKeys(flat, IMAGE_KEYS)
  const seed = typeof picked.seed === 'number' ? picked.seed : undefined
  delete picked.seed
  return {
    ...input,
    count: input.count ?? (typeof source.n === 'number' ? source.n : undefined),
    seed: input.seed ?? seed,
    extra: picked,
  }
}
