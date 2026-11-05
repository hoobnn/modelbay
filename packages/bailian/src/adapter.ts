/**
 * Bailian `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 *
 * The factory takes the declarations as a parameter so request/response logic can be
 * unit-tested without depending on the (parallel-generated) `src/models/**` files.
 */
import {
  defineAdapter,
  ProviderError,
  resolveModel,
  toBase64,
  selectDefaultModel,
  type AdapterContext,
  type AdapterRequest,
  type AssetRef,
  type CapabilityInput,
  type ModelDeclaration,
  type ModelLimits,
  type NormalizedCapability,
  type PlatformAdapter,
  type PollResult,
  type ProviderOutput,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, arr, requestJson, send, type Json } from './http'
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
    throw new ProviderError('unknown', 'Bailian result is missing a file URL')
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
  /** 覆盖要上传的字节（Node 子路径用来上传处理后的蒙版）。 */
  data?: Uint8Array,
): Promise<string> {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required to upload references')
  const source = await ctx.assets.load(ref.assetId)
  const mime = (source.mime || ref.mime || '').toLowerCase()
  const ext = FILE_EXT[mime]
  if (!ext) throw new ProviderError('invalid_input', `Unsupported reference MIME: ${mime}`)
  const maxBytes = mime.startsWith('image/')
    ? 20 * 1024 * 1024
    : mime.startsWith('audio/')
      ? 15 * 1024 * 1024
      : 100 * 1024 * 1024
  const payload = data ?? source.data
  if (!payload.length || payload.length > maxBytes)
    throw new ProviderError('invalid_input', 'Reference asset is empty or exceeds the size limit')
  const policy = asJson(
    (await requestJson(ctx, `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`))
      .data,
  )
  const host = policy.upload_host
  const dir = policy.upload_dir
  if (typeof host !== 'string' || typeof dir !== 'string')
    throw new ProviderError('unknown', 'Bailian upload policy is missing host/dir')
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
    if (typeof value !== 'string')
      throw new ProviderError('unknown', 'Bailian upload policy is incomplete')
    form.append(field, value)
  }
  form.append('key', objectKey)
  form.append('success_action_status', '200')
  form.append('file', new Blob([new Uint8Array(payload)], { type: mime }), name)
  const messages = {
    cancelled: 'Bailian upload cancelled',
    network: 'Bailian upload failed; submission outcome unknown',
  }
  let res: Response
  try {
    res = await send(ctx, host, { method: 'POST', body: form }, messages)
  } catch (cause) {
    throw new ProviderError('unavailable', 'Bailian reference upload failed', {
      cause,
      outcome: 'unknown',
    })
  }
  if (!res.ok)
    throw new ProviderError('unknown', `Bailian reference upload failed: HTTP ${res.status}`)
  return `oss://${objectKey}`
}

/** Encode an image AssetRef as a data URL for `text.chat` / `image.generate`. */
export async function inlineImage(ctx: AdapterContext, ref: AssetRef): Promise<string> {
  if (!ctx.assets)
    throw new ProviderError('invalid_input', 'An assets source is required for image references')
  const source = await ctx.assets.load(ref.assetId)
  const mime = (source.mime || ref.mime || '').toLowerCase()
  if (!mime.startsWith('image/'))
    throw new ProviderError('invalid_input', 'Reference asset must be an image')
  if (!source.data.length || source.data.length > 10 * 1024 * 1024)
    throw new ProviderError('invalid_input', 'Reference image is empty or exceeds 10 MB')
  return `data:${mime};base64,${toBase64(source.data)}`
}

async function chatMessages(
  ctx: AdapterContext,
  input: CapabilityInput<'text.chat'>,
): Promise<Json[]> {
  const result: Json[] = []
  for (const message of input.messages) {
    const content =
      typeof message.content === 'string'
        ? message.content
        : await Promise.all(
            message.content.map(async (part) =>
              part.type === 'text'
                ? { type: 'text', text: part.text }
                : { type: 'image_url', image_url: { url: await inlineImage(ctx, part.image) } },
            ),
          )
    const item: Json = { role: message.role, content }
    if (message.toolCalls) item.tool_calls = message.toolCalls
    if (message.toolCallId) item.tool_call_id = message.toolCallId
    if (message.toolName) item.name = message.toolName
    result.push(item)
  }
  return result
}

function chatBody(input: CapabilityInput<'text.chat'>, model: string, messages: Json[]): Json {
  const body: Json = { model, messages, stream: false }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens
  if (input.tools?.length) body.tools = input.tools
  if (input.toolChoice) body.tool_choice = input.toolChoice
  if (input.jsonSchema) body.response_format = { type: 'json_object' }
  // 平台特有字段原样透传（0001）：extra 直接合并进请求体，不改写键名。
  Object.assign(body, input.extra ?? {})
  return body
}

function parseChat(data: Json): ProviderOutput[] {
  const choice = asJson(arr(data.choices)[0])
  const message = asJson(choice.message)
  const outputs: ProviderOutput[] = []
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    outputs.push({
      type: 'tool_calls',
      calls: arr(message.tool_calls).map((call) => {
        const c = asJson(call)
        const fn = asJson(c.function)
        return {
          id: String(c.id ?? ''),
          name: String(fn.name ?? c.name ?? ''),
          arguments: asJson(fn.arguments ?? c.arguments ?? {}),
        }
      }),
    })
  }
  if (typeof message.content === 'string' && message.content)
    outputs.push({ type: 'text', text: message.content })
  if (!outputs.length) throw new ProviderError('unknown', 'Bailian chat response has no content')
  return outputs
}

function pollAfter(ctx: AdapterContext): number {
  const value = ctx.secret('BAILIAN_POLL_INTERVAL_MS') ?? ctx.secret('DASHSCOPE_POLL_INTERVAL_MS')
  const parsed = value ? Number(value) : 10_000
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 10_000
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
    throw new ProviderError('unknown', 'Bailian did not return task_id; do not resubmit the task')
  return { state: 'pending', remoteId: taskId, pollAfterMs: pollAfter(ctx) }
}

export interface BailianAdapterOptions {
  docsUrl?: string
  /**
   * 局部重绘的预处理与上传实现（Node 子路径 `@modelbay/bailian/image-edit` 提供）。
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

    async submit(request: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult> {
      const { capability, model } = request
      switch (capability) {
        case 'text.chat': {
          const input = request.input as CapabilityInput<'text.chat'>
          const messages = await chatMessages(ctx, input)
          const data = await requestJson(
            ctx,
            '/compatible-mode/v1/chat/completions',
            chatBody(input, model, messages),
          )
          return { state: 'succeeded', outputs: parseChat(data), usage: parseUsage(data) }
        }
        case 'image.generate': {
          const input = request.input as CapabilityInput<'image.generate'>
          if (!input.prompt.trim())
            throw new ProviderError('invalid_input', 'Image prompt is required')
          const content: Json[] = [{ text: input.prompt }]
          for (const ref of input.references ?? [])
            content.push({ image: await inlineImage(ctx, ref) })
          const parameters: Json = { watermark: false, n: input.count ?? 1 }
          if (input.seed !== undefined) parameters.seed = input.seed
          if (input.negativePrompt) parameters.negative_prompt = input.negativePrompt
          if (input.width !== undefined && input.height !== undefined)
            parameters.size = `${input.width}*${input.height}`
          Object.assign(parameters, input.extra ?? {})
          const data = await requestJson(ctx, GENERATION, {
            model,
            input: { messages: [{ role: 'user', content }] },
            parameters,
          })
          const urls = choiceContents(data)
            .filter((part) => part.image)
            .map((part) => part.image)
          if (!urls.length) throw new ProviderError('unknown', 'Bailian did not return any image')
          return {
            state: 'succeeded',
            outputs: urls.map((url) => fileOutput('image', url)),
            usage: parseUsage(data),
          }
        }
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
          const data = await requestJson(ctx, known?.endpoint ?? QWEN_TTS_PATH, {
            model,
            input: {
              ...input.extra,
              text: input.text,
              voice: input.voice ?? defaultVoiceFor(tts, model, true) ?? '',
              language_type: 'Auto',
            },
          })
          return { state: 'succeeded', outputs: [audioFile(data)], usage: parseUsage(data) }
        }
        case 'video.generate': {
          const input = request.input as CapabilityInput<'video.generate'>
          if (!input.prompt.trim() && !input.firstFrame && !input.references?.length)
            throw new ProviderError('invalid_input', 'Video needs a prompt or reference media')
          const media: Json[] = []
          if (input.firstFrame)
            media.push({
              type: 'first_frame',
              url: await uploadAsset(ctx, input.firstFrame, model),
            })
          if (input.lastFrame)
            media.push({ type: 'last_frame', url: await uploadAsset(ctx, input.lastFrame, model) })
          for (const ref of input.references ?? [])
            media.push({ type: `reference_${ref.kind}`, url: await uploadAsset(ctx, ref, model) })
          const parameters: Json = {
            resolution: input.resolution ?? '720P',
            ratio: input.aspectRatio ?? '16:9',
            watermark: false,
            audio: input.audio ?? true,
          }
          if (input.duration !== undefined) parameters.duration = input.duration
          if (input.seed !== undefined) parameters.seed = input.seed
          Object.assign(parameters, input.extra ?? {})
          const data = await requestJson(
            ctx,
            VIDEO_SYNTHESIS,
            {
              model,
              input: { prompt: input.prompt, ...(media.length ? { media } : {}) },
              parameters,
            },
            { asyncTask: true, oss: media.length > 0 },
          )
          const taskId = asJson(data.output).task_id
          if (typeof taskId !== 'string' || !taskId)
            throw new ProviderError('unknown', 'Bailian video submission is missing task_id')
          return { state: 'pending', remoteId: taskId, pollAfterMs: pollAfter(ctx) }
        }
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
              '局部重绘需要蒙版预处理与临时 OSS 上传：请从 @modelbay/bailian/image-edit 引入 prepareImageEditRequest，再用 createBailianAdapter(models, { edit: prepareImageEditRequest }) 注入',
            )
          const body = await options.edit(ctx, {
            model,
            prompt,
            image: input.image,
            mask: input.mask,
            count,
            ...(input.seed !== undefined ? { seed: input.seed } : {}),
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
          if (!options.process)
            throw new ProviderError(
              'invalid_input',
              '万相精修需要原图上传到临时 OSS：请从 @modelbay/bailian/image-edit 引入 prepareImageProcessRequest，再用 createBailianAdapter(models, { process: prepareImageProcessRequest }) 注入',
            )
          const body = await options.process(ctx, {
            model,
            image: input.image,
            operation: input.operation as 'upscale' | 'outpaint',
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(scale !== undefined ? { scale } : {}),
            ...(expansion !== undefined ? { expansion } : {}),
          })
          return submitImageTask(ctx, body)
        }
        default:
          throw new ProviderError('invalid_input', `Bailian does not support ${capability}`)
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
          if (!urls.length)
            throw new ProviderError('unknown', 'Bailian did not return edited images')
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
        return {
          state: 'failed',
          error: { code: 'cancelled', message: 'Bailian task was cancelled' },
        }
      if (status !== 'FAILED')
        throw new ProviderError(
          'unknown',
          'Bailian returned an unknown task status; keep the task ID',
        )
      const mapped = new ProviderError(
        'unknown',
        String(output.message ?? `Bailian task ${status}`),
        {
          cause: output,
        },
      )
      return {
        state: 'failed',
        error: { code: mapped.code, message: mapped.message, retryable: false },
      }
    },

    async cancel(remoteId: string, ctx: AdapterContext): Promise<void> {
      const data = await requestJson(ctx, `${TASKS}/${encodeURIComponent(remoteId)}/cancel`, {})
      const output = asJson(data.output)
      if (
        output.code ||
        (output.task_status && !['CANCELED', 'CANCELLED'].includes(String(output.task_status)))
      )
        throw new ProviderError('unknown', 'Bailian cancel was not accepted', { cause: output })
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

/** Capabilities that need the Node-only `@modelbay/bailian/image-edit` subpath. */
export const NODE_ONLY_CAPABILITIES = ['image.edit', 'image.process'] as const
