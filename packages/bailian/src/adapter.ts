/**
 * Bailian `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 *
 * The factory takes the declarations as a parameter so request/response logic can be
 * unit-tested without depending on the (parallel-generated) `src/models/**` files.
 */
import {
  defineAdapter,
  imageModelProblem,
  mediaBatchProblems,
  mediaRequirementProblems,
  ProviderError,
  resolveModel,
  selectDefaultModel,
  toModelInfo,
  type AdapterContext,
  type AdapterRequest,
  type AssetRef,
  type CapabilityInput,
  type LoadedFile,
  type ModelDeclaration,
  type ModelLimits,
  type NormalizedCapability,
  type PlatformAdapter,
  type PollResult,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import {
  chatCompletion,
  imageDataUrl,
  requireSseDone,
  sizeByArea,
  tierEdge,
} from '@modelbay/shared'
import {
  asJson,
  arr,
  bailianSettings,
  baseUrl,
  pollAfter,
  readAsset,
  remoteError,
  requestJson,
  requestResponse,
  withRetry,
  type Json,
} from './http'
import { liftMcpArguments, passthroughParameters } from './mcp/arguments'
import { optionsProblem, optionKeys } from './options'
import type { ImageEditPreparer, ImageProcessPreparer } from './image-edit'
import {
  audioFile,
  choiceContents,
  defaultVoiceFor,
  parseUsage,
  QWEN_TTS_PATH,
  synthesizeQwenAudioTts,
  ttsModels,
} from './tts'
import { BAILIAN_NATIVE_OPERATIONS, nativeOperationSchemas, runBailianNative } from './native'

const GENERATION = '/api/v1/services/aigc/multimodal-generation/generation'
const VIDEO_SYNTHESIS = '/api/v1/services/aigc/video-generation/video-synthesis'
const TASKS = '/api/v1/tasks'
/** 万相图像编辑 / 精修（异步任务，素材走临时 OSS）。 */
export const IMAGE_EDIT_PATH = '/api/v1/services/aigc/image2image/image-synthesis'

const FILE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

function fileOutput(kind: 'image' | 'video' | 'audio', url: unknown): ProviderOutput {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url))
    throw new ProviderError('unknown', '百炼生成结果缺少文件地址')
  const secure = new URL(url)
  secure.protocol = 'https:'
  return {
    type: 'file',
    kind,
    url: secure.href,
    mime: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/wav',
    name: `bailian.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`,
  }
}

/** Upload an asset to the DashScope temporary OSS store; returns an `oss://` address. */
export async function uploadAsset(
  ctx: AdapterContext,
  ref: AssetRef,
  model: string,
  /** 覆盖要上传的字节（Node 子路径用来上传处理后的蒙版）；此时 ref.mime 为准。 */
  data?: Uint8Array,
  /** 已经读过的素材，避免重复读取。 */
  loaded?: LoadedFile,
): Promise<string> {
  const source = data ? undefined : (loaded ?? (await readAsset(ctx, ref)))
  const mime = (data ? ref.mime || 'image/png' : source!.mime || ref.mime || '').toLowerCase()
  const ext = FILE_EXT[mime]
  if (!ext) throw new ProviderError('invalid_input', `万相参考素材格式不支持：${mime}`)
  const maxBytes = mime.startsWith('image/')
    ? 20 * 1024 * 1024
    : mime.startsWith('audio/')
      ? 15 * 1024 * 1024
      : 100 * 1024 * 1024
  const payload = data ?? source!.data
  if (!payload.length || payload.length > maxBytes)
    throw new ProviderError('invalid_input', '万相参考素材为空或超过大小限制')
  const policy = asJson(
    (await requestJson(ctx, `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`))
      .data,
  )
  const host = policy.upload_host
  const dir = policy.upload_dir
  if (typeof host !== 'string' || typeof dir !== 'string')
    throw new ProviderError('unknown', '百炼上传凭证缺少地址')
  const name = `${crypto.randomUUID()}.${ext}`
  const objectKey = `${dir}/${name}`
  const form = new FormData()
  const fields: Record<string, string> = {
    OSSAccessKeyId: 'oss_access_key_id',
    Signature: 'signature',
    policy: 'policy',
    'x-oss-object-acl': 'x_oss_object_acl',
    'x-oss-forbid-overwrite': 'x_oss_forbid_overwrite',
  }
  for (const [field, sourceKey] of Object.entries(fields)) {
    const value = policy[sourceKey]
    if (typeof value !== 'string') throw new ProviderError('unknown', '百炼上传凭证不完整')
    form.append(field, value)
  }
  form.append('key', objectKey)
  form.append('success_action_status', '200')
  form.append('file', new Blob([new Uint8Array(payload)], { type: mime }), name)
  let res: Response
  try {
    res = await ctx.fetch(host, { method: 'POST', body: form, signal: ctx.signal })
  } catch (cause) {
    throw new ProviderError(ctx.signal.aborted ? 'cancelled' : 'unavailable', '参考素材上传失败', {
      cause,
    })
  }
  if (!res.ok) throw remoteError(res.status, {}, ctx)
  return `oss://${objectKey}`
}

/** Encode an image AssetRef as a data URL for `text.chat` / `image.generate`. */
export function inlineImage(ctx: AdapterContext, ref: AssetRef): Promise<string> {
  return imageDataUrl({ files: { read: (r) => readAsset(ctx, r) } }, ref, {
    accept: (mime) => mime.startsWith('image/'),
    badMime: '参考资产必须是图片',
    maxBytes: 10 * 1024 * 1024,
    tooLarge: '参考图片超过 10 MB',
    allowEmpty: true,
  })
}

/** Select the default model via core (only `active` declarations are eligible). */
export function defaultModel(
  models: readonly ModelDeclaration[],
  capability: NormalizedCapability,
  channel = 'bailian',
): string | null {
  return selectDefaultModel(models, capability, channel)?.channel.id ?? null
}

/** 精修各边的说法 */
const EXPANSION_LABELS = { top: '向上', bottom: '向下', left: '向左', right: '向右' } as const

/** 模型的限制以声明为准（渠道上的限制覆盖模型上的）；没声明就不限制。 */
function modelLimits(models: ModelDeclaration[], model: string): ModelLimits {
  const found = resolveModel(models, model)
  return found ? { ...found.declaration.limits, ...found.channel.limits } : {}
}

/** 万相图像编辑 / 精修都是异步任务：提交后拿 task_id 去轮询。 */
async function submitImageTask(ctx: AdapterContext, body: Json): Promise<SubmitResult> {
  const data = await requestJson(ctx, IMAGE_EDIT_PATH, body, { asyncTask: true, oss: true })
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', '百炼未返回 task_id；请勿重新提交任务')
  return { state: 'pending', remoteId: taskId, pollAfterMs: pollAfter(ctx) }
}

/**
 * 精修的默认请求体构造（不需要 sharp）：上传原图 → 拼请求体。
 * AI 放大走 `super_resolution`，扩图走 `expand`，同一个 image-synthesis 端点。
 */
export const prepareProcessRequest: ImageProcessPreparer = async (ctx, opts) => {
  const baseImageUrl = await uploadAsset(ctx, opts.image, opts.model, undefined, opts.source)
  const parameters: Json = { n: 1, ...opts.extra }
  if (opts.operation === 'upscale') {
    if (opts.scale === undefined) throw new ProviderError('invalid_input', '缺少 AI 放大倍数')
    parameters.upscale_factor = opts.scale
  } else {
    const expansion = opts.expansion
    if (!expansion) throw new ProviderError('invalid_input', '缺少扩图比例')
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

type Resolved = NonNullable<ReturnType<typeof resolveModel>>

/** 图片：aspectRatio 换算成官方 size，组合与种子在联网前按声明预检。 */
async function generateImage(
  request: AdapterRequest,
  ctx: AdapterContext,
  resolved: Resolved,
): Promise<SubmitResult> {
  const { model } = request
  const input = request.input as CapabilityInput<'image.generate'>
  if (!input.prompt.trim()) throw new ProviderError('invalid_input', '图片提示词不能为空')
  const spec = toModelInfo(resolved.declaration, resolved.channel)
  const qwen = model.startsWith('qwen-image-3.0')
  if ((input.width === undefined) !== (input.height === undefined))
    throw new ProviderError('invalid_input', '图片宽高须一起填写')
  if (optionsProblem(spec.optionsSchema, input.extra ?? {}))
    throw new ProviderError('invalid_input', '百炼图片专属参数无效')
  const allowed = new Set([
    'size',
    'n',
    'seed',
    'watermark',
    'negative_prompt',
    'prompt_extend',
    ...(qwen ? ['prompt_extend_mode', 'enable_thinking'] : ['enable_sequential', 'thinking_mode']),
  ])
  const extra = Object.fromEntries(
    Object.entries(input.extra ?? {}).filter(([k]) => allowed.has(k)),
  ) as Json
  const n = (input.count ?? extra.n ?? 1) as number
  const refs = input.references?.length ?? 0
  if (!qwen && input.prompt.length > (spec.limits?.promptMaxLength ?? 5000))
    throw new ProviderError('invalid_input', '万相图片提示词最多 5000 字符')
  const aspect = typeof input.extra?.aspectRatio === 'string' ? input.extra.aspectRatio : '16:9'
  const combination = imageModelProblem(
    spec,
    {
      count: n,
      resolution: input.resolution,
      aspectRatio: aspect,
      // 预检与提交用同一个最终 seed：顶层优先，没填才看专属参数
      seed: input.seed ?? extra.seed,
      options: {
        ...extra,
        ...(input.width !== undefined && !extra.size
          ? { size: `${input.width}*${input.height}` }
          : {}),
      },
    },
    refs,
  )
  if (combination) throw new ProviderError('invalid_input', combination)
  let size = (extra.size ||
    (input.width !== undefined ? `${input.width}*${input.height}` : undefined)) as
    | string
    | undefined
  if (size === '1K' || size === '2K' || size === '4K') {
    if (qwen) throw new ProviderError('invalid_input', 'Qwen 原生 size 需要像素尺寸，不接受 K 档位')
    if (
      !spec.limits?.resolutions?.includes(size) ||
      (size === '4K' && (refs || extra.enable_sequential === true))
    )
      throw new ProviderError('invalid_input', '万相当前模式不支持该分辨率')
  } else if (!size && input.resolution) {
    const edge = tierEdge(input.resolution)
    if (!edge || !spec.limits?.resolutions?.includes(input.resolution))
      throw new ProviderError('invalid_input', '所选百炼图片模型不支持该分辨率')
    if (aspect === 'auto' && !qwen) size = input.resolution
    else {
      const { width, height } = sizeByArea(aspect, edge * edge)
      size = `${width}*${height}`
    }
  } else if (!size && aspect !== 'auto') {
    const ratios: Record<string, string> = {
      '16:9': '1664*936',
      '9:16': '936*1664',
      '1:1': '1024*1024',
      '4:3': '1536*1152',
      '3:4': '1152*1536',
      '21:9': '1904*816',
      '3:2': '1536*1024',
      '2:3': '1024*1536',
    }
    size = ratios[aspect]
  }
  const issue = imageModelProblem(
    spec,
    {
      count: n,
      resolution: input.resolution,
      aspectRatio: aspect,
      seed: input.seed ?? extra.seed,
      options: { ...extra, size },
    },
    refs,
  )
  if (issue) throw new ProviderError('invalid_input', issue)
  // DashScope 的智能尺寸通过省略 size 表达；Qwen 不接受 K 字符串。
  if (extra.size && size !== 'auto' && !/^(?:1K|2K|4K|[1-9]\d*[x*][1-9]\d*)$/.test(String(size)))
    throw new ProviderError('invalid_input', '自定义尺寸格式无效')
  if (typeof size === 'string') size = size.replace('x', '*')
  if (size === 'auto') size = undefined
  // 种子范围以模型声明为准
  const seed = input.seed ?? (extra.seed as number | undefined)
  if (seed !== undefined) {
    const range = typeof spec.limits?.seed === 'object' ? spec.limits.seed : undefined
    if (!range) throw new ProviderError('invalid_input', '所选百炼图片模型不支持 seed')
    if (!Number.isInteger(seed) || Number(seed) < range.min || Number(seed) > range.max)
      throw new ProviderError(
        'invalid_input',
        `百炼图片 seed 须为 ${range.min}–${range.max} 的整数`,
      )
  }
  const content: Json[] = [{ text: input.prompt }]
  for (const ref of input.references ?? []) content.push({ image: await inlineImage(ctx, ref) })
  const data = await requestJson(ctx, GENERATION, {
    model,
    input: { messages: [{ role: 'user', content }] },
    parameters: {
      watermark: false,
      ...passthroughParameters(input),
      ...extra,
      size,
      n,
      ...(seed !== undefined ? { seed } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
    },
  })
  const urls = choiceContents(data)
    .filter((part) => part.image)
    .map((part) => part.image)
  if (!urls.length) throw new ProviderError('unknown', '百炼没有返回生成图片')
  return {
    state: 'succeeded',
    outputs: urls.map((url) => fileOutput('image', url)),
    usage: parseUsage(data),
  }
}

/** 视频：时长 / 分辨率 / 画幅 / 素材数量与总时长在上传之前按声明检查。 */
async function generateVideo(
  request: AdapterRequest,
  ctx: AdapterContext,
  resolved: Resolved,
): Promise<SubmitResult> {
  const { model } = request
  const input = request.input as CapabilityInput<'video.generate'>
  const spec = toModelInfo(resolved.declaration, resolved.channel)
  const limits = spec.limits ?? {}
  if (!input.prompt.trim() && !input.firstFrame && !input.references?.length)
    throw new ProviderError('invalid_input', '视频需要提示词或参考素材')
  if (input.lastFrame && !input.firstFrame)
    throw new ProviderError('invalid_input', '尾帧须与首帧一起填写')
  if ((input.firstFrame || input.lastFrame) && input.references?.length)
    throw new ProviderError('invalid_input', '首尾帧不能与参考素材混用')
  if (
    (input.firstFrame && input.firstFrame.kind !== 'image') ||
    (input.lastFrame && input.lastFrame.kind !== 'image')
  )
    throw new ProviderError('invalid_input', '首尾帧须为图片资产')
  if (
    input.duration !== undefined &&
    input.duration !== -1 &&
    (!Number.isInteger(input.duration) || input.duration < 2 || input.duration > 30)
  )
    throw new ProviderError('invalid_input', '万相视频时长须为 -1 或 2–30 秒整数')
  for (const [kind, max] of [
    ['image', 10],
    ['audio', 5],
    ['video', 5],
  ] as const) {
    if ((input.references ?? []).filter((ref) => ref.kind === kind).length > max)
      throw new ProviderError('invalid_input', `万相 ${kind} 参考数量超过 ${max}`)
  }
  const resolution = input.resolution ?? limits.defaultResolution ?? '720P'
  const ratio = input.aspectRatio === 'auto' ? 'adaptive' : (input.aspectRatio ?? '16:9')
  if (limits.resolutions && !limits.resolutions.includes(resolution))
    throw new ProviderError('invalid_input', '万相不支持该视频分辨率')
  if (ratio !== 'adaptive' && limits.aspectRatios && !limits.aspectRatios.includes(ratio))
    throw new ProviderError('invalid_input', '万相不支持该视频画幅')
  if (optionsProblem(spec.optionsSchema, input.extra ?? {}))
    throw new ProviderError('invalid_input', '万相视频专属参数无效')
  // 有专属参数声明的模型只收声明内的键；没有声明的模型原样收下，但不能覆盖通用参数
  const optionNames = optionKeys(spec.optionsSchema)
  const picked = Object.fromEntries(
    Object.entries(input.extra ?? {}).filter(
      ([key]) => !spec.optionsSchema || optionNames.includes(key),
    ),
  ) as Json
  const { adaptive_duration: adaptive, ...extra } = picked
  const sources = new Map<string, LoadedFile>()
  for (const ref of input.references ?? []) {
    if (ref.kind !== 'image' && ref.kind !== 'audio' && ref.kind !== 'video')
      throw new ProviderError('invalid_input', '视频参考素材须为图片、音频或视频')
    sources.set(ref.assetId, await readAsset(ctx, ref))
  }
  for (const kind of ['image', 'video', 'audio'] as const) {
    const samples = (input.references ?? [])
      .filter((ref) => ref.kind === kind)
      .map((ref) => {
        const source = sources.get(ref.assetId)
        return {
          sample: { mime: source?.mime, size: source?.data.length, duration: source?.duration },
        }
      })
    const problems = mediaBatchProblems({
      requirement: limits.media?.[kind],
      samples,
      title: spec.title,
      label: kind === 'video' ? '参考视频' : kind === 'audio' ? '参考音频' : '参考图片',
      // 宿主给出媒体元数据（files）时缺项也拒绝
      strict: Boolean(ctx.files),
      // 自适应时长与 -1 由模型决定输出时长，这时不与输出时长相加
      ...(kind === 'video'
        ? {
            outputDuration: input.duration,
            outputDurationByModel: adaptive === true || input.duration === -1,
          }
        : {}),
    })
    if (problems.length) throw new ProviderError('invalid_input', problems[0]!)
  }
  const media: Json[] = []
  if (input.firstFrame)
    media.push({ type: 'first_frame', url: await uploadAsset(ctx, input.firstFrame, model) })
  if (input.lastFrame)
    media.push({ type: 'last_frame', url: await uploadAsset(ctx, input.lastFrame, model) })
  for (const ref of input.references ?? [])
    media.push({
      type: `reference_${ref.kind}`,
      url: await uploadAsset(ctx, ref, model, undefined, sources.get(ref.assetId)),
    })
  const data = await requestJson(
    ctx,
    VIDEO_SYNTHESIS,
    {
      model,
      input: { prompt: input.prompt, ...(media.length ? { media } : {}) },
      parameters: {
        watermark: false,
        ...passthroughParameters(input),
        ...extra,
        resolution,
        ratio,
        audio: input.audio ?? true,
        ...(adaptive === true
          ? { duration: -1 }
          : input.duration !== undefined
            ? { duration: input.duration }
            : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    },
    { asyncTask: true, oss: media.length > 0 },
  )
  const taskId = asJson(data.output).task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new ProviderError('unknown', '百炼未返回 task_id；请勿重新提交任务')
  return { state: 'pending', remoteId: taskId, pollAfterMs: pollAfter(ctx) }
}

export interface BailianAdapterOptions {
  docsUrl?: string
  /**
   * 局部重绘的预处理与上传实现（Node 子路径 `@modelbay/bailian/node` 提供）。
   *
   * 没注入时 `image.edit` 报 `invalid_input`，不会发出缺蒙版或缺素材地址的请求。
   */
  edit?: ImageEditPreparer
  /**
   * 精修（AI 放大 / 扩图）的预处理与上传实现（同上）。
   *
   * 没注入时 `image.process` 报 `invalid_input`。
   */
  process?: ImageProcessPreparer
}

export function createBailianAdapter(
  models: ModelDeclaration[],
  options: BailianAdapterOptions = {},
): PlatformAdapter {
  const adapter: PlatformAdapter = {
    id: 'aliyun/bailian',
    title: 'Alibaba Bailian / DashScope',
    channels: ['bailian'],
    models,
    nativeOperations: [...BAILIAN_NATIVE_OPERATIONS],
    nodeOnly: ['image-edit'],
    docsUrl: options.docsUrl ?? 'https://help.aliyun.com/zh/model-studio/',

    async submit(raw: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult> {
      const request = {
        ...raw,
        input: liftMcpArguments(raw.capability, raw.model, raw.input as Record<string, unknown>),
      } as AdapterRequest
      const { capability, model } = request
      if (model === 'qwen3-tts-instruct-flash')
        throw new ProviderError(
          'invalid_input',
          'qwen3-tts-instruct-flash 已下线；请选择 qwen3-tts-flash，语气指令请使用豆包语音',
        )
      // 远端模型列表里的对话模型没有静态声明，放行；其余必须是声明过的百炼模型
      const resolved = resolveModel(models, model)
      if (
        !resolved?.declaration.capabilities.includes(capability) &&
        !(request.remoteOnly && capability === 'text.chat')
      )
        throw new ProviderError('invalid_input', `百炼模型 ${model} 不支持 ${capability}`)
      switch (capability) {
        case 'text.chat':
          return chatCompletion({
            ctx,
            label: '百炼',
            baseURL: `${baseUrl(ctx)}/compatible-mode/v1`,
            // 鉴权、传输失败和 HTTP 错误码归类沿用 requestResponse；流必须以 [DONE] 结束
            fetch: async (url, init) => {
              const path = String(url).slice(baseUrl(ctx).length)
              const body = JSON.parse(String(init?.body)) as Json
              return requireSseDone(
                await requestResponse(ctx, path, body),
                () =>
                  new ProviderError('unknown', '百炼回答不完整或未收到 [DONE]；请勿自动重新提交'),
              )
            },
            model,
            input: request.input as CapabilityInput<'text.chat'>,
            image: (ref) => inlineImage(ctx, ref),
            structured: 'json_object',
            streamError: (error) => withRetry(remoteError(200, { error }, ctx), 'POST'),
          })
        case 'image.generate':
          return generateImage(request, ctx, resolved!)
        case 'audio.speech': {
          const input = request.input as CapabilityInput<'audio.speech'>
          const tts = ttsModels(models)
          const known = tts.find((item) => item.id === model)
          if (known?.protocol === 'synthesizer') {
            const result = await synthesizeQwenAudioTts(
              ctx,
              {
                text: input.text,
                model,
                voice: input.voice,
                instructions: input.instruction,
                parameters: asJson(input.extra),
              },
              tts,
            )
            return { state: 'succeeded', outputs: [fileOutput('audio', result.url)] }
          }
          const limits = modelLimits(models, model)
          // 平台按 Unicode 码点计字数
          // oxlint-disable-next-line typescript/no-misused-spread -- 平台按 Unicode 码点计字数
          const length = [...input.text].length
          const maxText = limits.promptMaxLength ?? 600
          if (!input.text.trim() || length > maxText)
            throw new ProviderError('invalid_input', `千问语音文本须为 1–${maxText} 字符`)
          if (
            limits.instruction === false &&
            (input.instruction ||
              ['instruction', 'instructions', 'optimize_instructions'].some(
                (field) => input.extra?.[field] !== undefined,
              ))
          )
            throw new ProviderError(
              'invalid_input',
              'qwen3-tts-flash 不支持语气指令，请使用豆包语音',
            )
          if (limits.speed === false && input.speed !== undefined && input.speed !== 1)
            throw new ProviderError(
              'invalid_input',
              '千问 TTS 不支持 speed 参数；可使用 instruct 模型描述语速',
            )
          const settings = bailianSettings(ctx)
          const voice =
            input.voice ||
            (typeof settings.voice === 'string' && settings.voice) ||
            defaultVoiceFor(tts, model, true) ||
            ''
          const data = await requestJson(ctx, known?.endpoint ?? QWEN_TTS_PATH, {
            model,
            input: {
              ...input.extra,
              text: input.text,
              voice,
              language_type:
                (typeof (input as Json).language === 'string' && (input as Json).language) ||
                (typeof settings.language === 'string' && settings.language) ||
                'Auto',
            },
          })
          return { state: 'succeeded', outputs: [audioFile(data)], usage: parseUsage(data) }
        }
        case 'video.generate':
          return generateVideo(request, ctx, resolved!)
        case 'image.edit': {
          const input = request.input as CapabilityInput<'image.edit'>
          const prompt = typeof input.prompt === 'string' ? input.prompt : ''
          if (!prompt.trim()) throw new ProviderError('invalid_input', '局部重绘需要提示词')
          const limits = modelLimits(models, model)
          const maxCount = limits.count?.max ?? 1
          const count = input.count ?? 1
          // 次数在上传之前拒绝：不满足时不会先传两张图再失败。
          if (!Number.isInteger(count) || count < 1 || count > maxCount)
            throw new ProviderError('invalid_input', `万相图像编辑一次仅支持生成 ${maxCount} 张`)
          if (!options.edit)
            throw new ProviderError(
              'invalid_input',
              '局部重绘需要蒙版预处理与临时 OSS 上传：请从 @modelbay/bailian/node 引入 prepareImageEditRequest，再用 createBailianAdapter(models, { edit: prepareImageEditRequest }) 注入',
            )
          const body = await options.edit(ctx, {
            model,
            prompt,
            image: input.image,
            mask: input.mask,
            count,
            ...(input.seed !== undefined ? { seed: input.seed } : {}),
            ...(input.extra ? { extra: input.extra } : {}),
          })
          return submitImageTask(ctx, body)
        }
        case 'image.process': {
          const input = request.input as CapabilityInput<'image.process'>
          const limits = modelLimits(models, model)
          const operations = limits.imageOperations ?? ['upscale', 'outpaint']
          if (!operations.includes(input.operation))
            throw new ProviderError('invalid_input', `万相精修支持的操作：${operations.join('、')}`)
          if (!input.image || input.image.kind !== 'image')
            throw new ProviderError('invalid_input', '万相精修需要图片原图')
          const maxPrompt = limits.promptMaxLength ?? 800
          if (input.prompt && input.prompt.length > maxPrompt)
            throw new ProviderError('invalid_input', `万相精修提示词不能超过 ${maxPrompt} 字`)
          const rules = limits.process
          // 缺值时用声明里的默认值（产品层的默认值也写在声明里，代码不硬编码）。
          let scale: number | undefined
          let expansion: { top: number; bottom: number; left: number; right: number } | undefined
          if (input.operation === 'upscale') {
            const range = rules?.scale
            if (!range) throw new ProviderError('invalid_input', '所选模型不支持 AI 放大')
            scale = input.scale ?? range.default
            if (scale === undefined)
              throw new ProviderError(
                'invalid_input',
                `请指定 AI 放大倍数（${range.min}–${range.max}）`,
              )
            if (!Number.isFinite(scale) || scale < range.min || scale > range.max)
              throw new ProviderError('invalid_input', `AI 放大倍数须为 ${range.min}–${range.max}`)
          } else {
            const range = rules?.expansion
            if (!range) throw new ProviderError('invalid_input', '所选模型不支持扩图')
            expansion = input.expansion ?? range.default
            if (!expansion)
              throw new ProviderError(
                'invalid_input',
                `请指定扩图比例（各边 ${range.min}–${range.max}）`,
              )
            for (const side of ['top', 'bottom', 'left', 'right'] as const) {
              const value = expansion[side]
              if (!Number.isFinite(value) || value < range.min || value > range.max)
                throw new ProviderError(
                  'invalid_input',
                  `扩图${EXPANSION_LABELS[side]}比例须为 ${range.min}–${range.max}`,
                )
            }
          }
          const source = await readAsset(ctx, input.image)
          if (!source.data.length)
            throw new ProviderError('invalid_input', '万相精修原图不能是空文件')
          // 原图的格式要求以模型声明为准；宿主给出媒体元数据（files）时缺项也拒绝
          const problems = mediaRequirementProblems(
            limits.media?.process,
            {
              mime: source.mime,
              size: source.data.length,
              width: source.width,
              height: source.height,
            },
            {
              title: resolved!.declaration.title,
              label: '万相精修原图',
              strict: Boolean(ctx.files),
            },
          )
          if (problems.length) throw new ProviderError('invalid_input', problems[0]!)
          const body = await (options.process ?? prepareProcessRequest)(ctx, {
            model,
            image: input.image,
            source,
            operation: input.operation as 'upscale' | 'outpaint',
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(scale !== undefined ? { scale } : {}),
            ...(expansion !== undefined ? { expansion } : {}),
          })
          return submitImageTask(ctx, body)
        }
        default:
          throw new ProviderError('invalid_input', `百炼暂不支持 ${capability}`)
      }
    },

    async poll(remoteId: string, ctx: AdapterContext): Promise<PollResult> {
      const data = await requestJson(ctx, `${TASKS}/${encodeURIComponent(remoteId)}`)
      const output = asJson(data.output)
      const status = output.task_status
      if (status === 'PENDING' || status === 'RUNNING')
        return {
          state: 'pending',
          pollAfterMs: pollAfter(ctx),
          remote: status === 'PENDING' ? 'queued' : 'running',
        }
      if (status === 'SUCCEEDED') {
        if (Array.isArray(output.results)) {
          const urls = arr(output.results)
            .map(asJson)
            .filter((result) => typeof result.url === 'string')
            .map((result) => result.url)
          if (!urls.length) throw new ProviderError('unknown', '百炼没有返回编辑后的图片')
          return {
            state: 'succeeded',
            outputs: urls.map((url) => fileOutput('image', url)),
            usage: parseUsage(data),
          }
        }
        return {
          state: 'succeeded',
          outputs: [fileOutput('video', output.video_url ?? asJson(output.results).video_url)],
          usage: parseUsage(data),
        }
      }
      if (status === 'CANCELED' || status === 'CANCELLED')
        return { state: 'failed', error: { code: 'cancelled', message: '百炼任务已取消' } }
      // 查询异常不等于远端生成失败；抛错让宿主保留任务 ID，避免恢复时再次付费提交。
      if (status !== 'FAILED')
        throw new ProviderError('unknown', '百炼返回未知任务状态，请保留原任务并恢复查询')
      const mapped = remoteError(200, output, ctx)
      return {
        state: 'failed',
        error: {
          code: mapped.code,
          message: output.message ? mapped.message : `百炼任务状态：${String(status)}`,
          retryable: mapped.retryable,
        },
      }
    },

    async cancel(remoteId: string, ctx: AdapterContext): Promise<void> {
      const data = await requestJson(ctx, `${TASKS}/${encodeURIComponent(remoteId)}/cancel`, {})
      const output = asJson(data.output)
      if (
        output.code ||
        (output.task_status && !['CANCELED', 'CANCELLED'].includes(String(output.task_status)))
      )
        throw remoteError(400, output, ctx)
    },

    async native(
      op: string,
      params: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<unknown> {
      return runBailianNative(op, params, ctx, models)
    },
  }
  return defineAdapter(adapter)
}

/** Native operation parameter schemas, re-exported for the MCP generator. */
export { nativeOperationSchemas }

/** Capabilities that need the Node-only `@modelbay/bailian/node` subpath. */
export const NODE_ONLY_CAPABILITIES = ['image.edit', 'image.process'] as const
