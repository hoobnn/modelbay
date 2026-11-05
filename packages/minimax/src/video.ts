/**
 * video.generate（H3 V2）：首尾帧与多模态参考按顺序进 content；
 * 时长 / 分辨率 / 画幅按各型号声明（Lite、Highspeed、Max 各不相同），不写死。
 */
import {
  ProviderError,
  videoReferenceProblem,
  videoReferencePrompt,
  type AdapterContext,
  type AdapterRequest,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { videoReferences } from '@modelbay/shared'
import { withFiles } from './files'
import { requestJson } from './http'
import { optionSource, pickKeys, required, taskId } from './util'

export async function video(
  request: AdapterRequest<'video.generate'>,
  model: string,
  spec: ModelDeclaration,
  adapterCtx: AdapterContext,
): Promise<SubmitResult> {
  const ctx = withFiles(adapterCtx)
  const input = request.input
  required(input.prompt, 7000, '视频提示词')
  // 参考素材的格式要求以模型声明为准，宿主在运行前读的是同一份声明
  const limits = spec.limits
  const duration = input.duration ?? 5
  const defaultResolution = limits?.defaultResolution
  if (!defaultResolution) throw new ProviderError('unknown', '所选 H3 模型未声明默认分辨率')
  const resolution = input.resolution ?? defaultResolution
  const range = limits?.duration || { min: 4, max: 15 }
  if (!Number.isInteger(duration) || duration < range.min || duration > range.max)
    throw new ProviderError(
      'invalid_input',
      `${spec.title} 时长须为 ${range.min}–${range.max} 整数秒`,
    )
  if (!limits?.resolutions?.includes(resolution))
    throw new ProviderError('invalid_input', '所选 H3 模型不支持该分辨率')
  const frames = Boolean(input.firstFrame || input.lastFrame)
  if (frames && input.references?.length)
    throw new ProviderError('invalid_input', 'H3 首尾帧和参考图不能混用')
  const imageMax = limits.references?.max ?? 9
  if ((input.references ?? []).filter((ref) => ref.kind === 'image').length > imageMax)
    throw new ProviderError('invalid_input', `H3 最多支持 ${imageMax} 张参考图`)
  if (input.seed !== undefined) throw new ProviderError('invalid_input', 'H3 V2 不支持 seed')
  const ratio = frames
    ? 'adaptive'
    : input.aspectRatio === 'auto'
      ? 'adaptive'
      : (input.aspectRatio ?? '16:9')
  const ratios = ['adaptive', ...(limits.aspectRatios ?? []).filter((item) => item !== 'auto')]
  if (!ratios.includes(ratio)) throw new ProviderError('invalid_input', 'H3 不支持该宽高比')
  if (ratio === 'adaptive' && (!input.references?.length || model === 'MiniMax-H3-Lite') && !frames)
    throw new ProviderError('invalid_input', '文生视频和 H3-Lite 参考模式需要选择具体画幅')
  const counts = { image: 0, video: 0, audio: 0 }
  for (const ref of input.references ?? [])
    if (ref.kind === 'image' || ref.kind === 'video' || ref.kind === 'audio') counts[ref.kind]++
  const referenceProblem = videoReferenceProblem(input.prompt, counts)
  if (referenceProblem) throw new ProviderError('invalid_input', referenceProblem)
  const content: unknown[] = [{ type: 'text', text: videoReferencePrompt(input.prompt, 'minimax') }]
  for (const [role, refs] of [
    ['first_frame', input.firstFrame ? [input.firstFrame] : []],
    ['last_frame', input.lastFrame ? [input.lastFrame] : []],
  ] as const) {
    for (const ref of refs) {
      if (ref.kind !== 'image') throw new ProviderError('invalid_input', '首尾帧须为图片资产')
      const [frame] = await videoReferences([ref], ctx, {
        image: 1,
        video: 0,
        audio: 0,
        platform: 'minimax',
        requirements: limits.media,
        title: spec.title,
      })
      content.push({ ...frame, role })
    }
  }
  if (input.references?.length)
    content.push(
      ...(await videoReferences(input.references, ctx, {
        image: imageMax,
        video: limits.referenceMedia?.video ?? 3,
        audio: limits.referenceMedia?.audio ?? 3,
        allowAudioOnly: limits.referenceMedia?.audioOnly ?? true,
        platform: 'minimax',
        requirements: limits.media,
        title: spec.title,
      })),
    )
  const data = await requestJson(ctx, '/v2/video_generation', {
    model,
    content,
    duration,
    resolution,
    ratio,
    ...videoOptions(input),
  })
  if (data.task_id === undefined || data.task_id === null || data.task_id === '')
    throw new ProviderError('unknown', 'MiniMax 提交响应缺少 task_id；提交状态未知，请勿重新生成', {
      retryable: false,
      outcome: 'unknown',
    })
  return { state: 'pending', remoteId: taskId(data.task_id), pollAfterMs: 10_000 }
}

/** MCP generate_video 的 parameters 白名单：callback_url / aigc_watermark */
function videoOptions(input: object) {
  const picked = pickKeys(optionSource(input), ['callback_url', 'aigc_watermark'])
  if (picked.callback_url !== undefined && typeof picked.callback_url !== 'string')
    throw new ProviderError('invalid_input', 'MiniMax callback_url 须为字符串')
  if (picked.aigc_watermark !== undefined && typeof picked.aigc_watermark !== 'boolean')
    throw new ProviderError('invalid_input', 'MiniMax aigc_watermark 须为布尔值')
  return picked
}
