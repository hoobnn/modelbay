/**
 * image.generate（MiniMax-H3-Image 系列）：没有参考图走文生图 POST /v1/images/generations，
 * 有参考图走图片编辑 POST /v1/images/edits，两者同步返回。上下限全部取自模型声明。
 * 2026-11-11 核对：https://platform.minimax.cn/docs/api-reference/image-generation-h3-generations、
 * https://platform.minimax.cn/docs/api-reference/image-generation-h3-edits
 */
import {
  imageModelProblem,
  ProviderError,
  type AdapterContext,
  type AdapterRequest,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { videoReferences } from '@modelbay/shared'
import { z } from 'zod'
import { withFiles } from './files'
import { arr, asJson, errorCode, requestJson } from './http'
import { modelInfo } from './image'
import { optionSource, pickKeys, required } from './util'

const H3_KEYS = [
  'size',
  'aspectRatio',
  'output_format',
  'output_compression',
  'disable_prompt_enhanced',
  'aigc_watermark',
] as const

/** 与声明里的 optionsSchema 一致；jpg 是官方认的 jpeg 写法。 */
const h3Options = z.object({
  size: z.string().optional(),
  aspectRatio: z.string().optional(),
  output_format: z.enum(['jpeg', 'jpg', 'png', 'webp']).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  disable_prompt_enhanced: z.boolean().optional(),
  aigc_watermark: z.boolean().optional(),
})

const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp' }

export async function h3Image(
  request: AdapterRequest<'image.generate'>,
  model: string,
  spec: ModelDeclaration,
  adapterCtx: AdapterContext,
): Promise<SubmitResult> {
  const ctx = withFiles(adapterCtx)
  const input = request.input
  const limits = spec.limits ?? {}
  required(input.prompt, limits.promptMaxLength ?? 32000, '图片提示词')
  const source = optionSource(input)
  const parsed = h3Options.safeParse(
    pickKeys({ ...source, aspectRatio: source.aspectRatio ?? source.aspect_ratio }, H3_KEYS),
  )
  if (!parsed.success) throw new ProviderError('invalid_input', 'MiniMax 图片专属参数无效')
  const options = parsed.data
  const references = input.references ?? []
  const n = input.count ?? 1

  // 宽高与「自定义尺寸」都换成官方的 宽x高；给了宽高就不再传画幅和面积档（官方会返回 400）
  if ((input.width === undefined) !== (input.height === undefined))
    throw new ProviderError('invalid_input', '图片宽高须一起填写')
  if (input.width !== undefined && options.size && options.size !== 'auto')
    throw new ProviderError('invalid_input', '宽高和自定义尺寸只能填一个')
  const size =
    input.width !== undefined
      ? `${input.width}x${input.height}`
      : options.size?.trim().replace('*', 'x') || undefined
  const explicit = size !== undefined && size !== 'auto'
  const aspectRatio = explicit ? undefined : options.aspectRatio
  const area = explicit ? undefined : input.resolution

  const issue = imageModelProblem(
    modelInfo(spec),
    {
      ...input,
      width: undefined,
      height: undefined,
      resolution: area,
      aspectRatio,
      options: { ...options, ...(size ? { size } : {}) },
    },
    references.length,
  )
  if (issue) throw new ProviderError('invalid_input', issue)
  if (options.disable_prompt_enhanced) {
    if (references.length)
      throw new ProviderError('invalid_input', `${spec.title} 图片编辑始终开启提示词增强`)
    if (!explicit && (!aspectRatio || aspectRatio === 'auto'))
      throw new ProviderError(
        'invalid_input',
        `${spec.title} 关闭提示词增强时须指定画幅（不能是 auto）或自定义尺寸`,
      )
  }

  const images = references.length
    ? (
        await videoReferences(references, ctx, {
          image: limits.references?.max ?? 16,
          video: 0,
          audio: 0,
          platform: 'minimax',
          requirements: limits.media,
          title: spec.title,
          strict: Boolean(adapterCtx.files),
        })
      ).map((item) => ({ image_url: asJson(item.image_url).url }))
    : undefined

  const data = await requestJson(ctx, images ? '/v1/images/edits' : '/v1/images/generations', {
    model,
    prompt: input.prompt,
    ...(images ? { images } : {}),
    n,
    size,
    aspect_ratio: aspectRatio,
    area,
    output_format: options.output_format,
    output_compression: options.output_compression,
    aigc_watermark: options.aigc_watermark,
    ...(images ? {} : { disable_prompt_enhanced: options.disable_prompt_enhanced }),
    response_format: 'url',
    // 流式只为保活（见 http.ts imageStream），结果仍按非流式结构处理
    stream: true,
  })

  // data 始终 n 项：成功的有 url，失败的（含未过内容安全检查）只有 error；全部失败时官方返回 HTTP 错误
  const items = arr(data.data).map(asJson)
  const urls = items
    .map((item) => item.url)
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
  const failures = items.map((item) => asJson(item.error)).filter((error) => error.code)
  if (!urls.length) {
    const first = failures[0]
    if (first)
      throw new ProviderError(
        errorCode(String(first.code)),
        `MiniMax：${String(first.message ?? '图片生成失败')}`,
        { cause: { code: first.code, message: first.message }, retryable: false },
      )
    throw new ProviderError('unknown', 'MiniMax 响应缺少图片', { retryable: false })
  }
  if (urls.length < n)
    ctx.log('MiniMax 仅生成部分图片，不自动重试', {
      requested: n,
      received: urls.length,
      errors: failures.map((error) => error.code),
    })
  const mime = MIME[String(data.output_format ?? options.output_format)] ?? 'image/jpeg'
  return {
    state: 'succeeded',
    outputs: urls.map((url) => ({ type: 'file', kind: 'image', mime, url })),
    usage: { images: urls.length },
  }
}
