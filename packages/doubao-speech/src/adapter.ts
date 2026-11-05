/**
 * Doubao Speech `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 * Speech synthesis is synchronous (single POST), so `poll` is intentionally absent.
 */
import {
  defineAdapter,
  mediaRequirementProblems,
  ProviderError,
  selectDefaultModel,
  toBase64,
  type AdapterContext,
  type AdapterRequest,
  type AssetRef,
  type CapabilityInput,
  type LoadedFile,
  type ModelDeclaration,
  type NormalizedCapability,
  type PlatformAdapter,
  type ProviderOutput,
  type SubmitResult,
  type TranscriptSegment,
  type VoiceCloneInput,
  type VoiceCreationResult,
  type VoiceDesignInput,
} from '@modelbay/core'
import { asJson, arr, events, failure, headers, incomplete, postRaw, type Json } from './http'
import { cloneVoice, designVoice, voiceStatus } from './voice'
import {
  buildSpeechRequest,
  decodeAudioStream,
  resolveSpeechSettings,
  settingsOverrides,
  synthesizeSpeech,
  type SpeechExtras,
  text,
  type SpeechSettings,
} from './speech'
import { DOUBAO_NATIVE_OPERATIONS, nativeOperationSchemas, runDoubaoNative } from './native'

const AUDIO_CREATE_PATH = '/api/v3/tts/create'
const ASR_FLASH_PATH = '/api/v3/auc/bigmodel/recognize/flash'

const ASR_FORMAT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
}

/** Select the default model via core (only `active` declarations are eligible). */
export function defaultModel(
  models: readonly ModelDeclaration[],
  capability: NormalizedCapability,
  channel = 'doubao-speech',
): string | null {
  return selectDefaultModel(models, capability, channel)?.channel.id ?? null
}

/** Build the Seed Audio (music / sound-effect) request body. */
export function buildAudioCreateBody(
  input: CapabilityInput<'audio.music'>,
  settings: SpeechSettings,
  kind: 'audio.music' | 'audio.sfx',
): Json {
  if (
    input.duration !== undefined &&
    (!Number.isFinite(input.duration) || input.duration <= 0 || input.duration > 120)
  )
    throw new ProviderError('invalid_input', '音频时长须大于 0 且不超过 120 秒')
  const prompt = text(input.prompt, '音频描述')
  const lead =
    kind === 'audio.music' ? '仅生成音乐，不要人声对白。' : '仅生成音效，不要音乐或人声对白。'
  const duration =
    input.duration === undefined ? '' : `目标时长 ${Number(input.duration.toFixed(1))} 秒。`
  return {
    text_prompt: text(`${lead}${duration}${prompt}`, '完整音频描述'),
    audio_config: { format: settings.format, sample_rate: Number(settings.sampleRate) },
  }
}

/** MCP 工具目录里的原始识别参数（SDK 调用不传，行为不变）。 */
interface AsrExtras {
  hotwords?: unknown
  context?: unknown
  itn?: unknown
  punc?: unknown
  ddc?: unknown
  utterances?: unknown
}

/** Build the flash ASR request body from a loaded audio asset. */
export function buildFlashAsrBody(
  input: CapabilityInput<'audio.transcribe'>,
  loaded: { data: Uint8Array; mime: string },
): Json {
  const format = ASR_FORMAT[loaded.mime.toLowerCase()]
  if (!format)
    throw new ProviderError('invalid_input', '极速识别支持 MP3、WAV、Ogg Opus、FLAC、M4A 音频')
  // 来源：https://docs.volcengine.com/docs/6561/1354868（录音文件识别标准版，极速版请求字段与其一致，
  // 2026-11-06 核对）：request.enable_itn / enable_punc / enable_ddc / show_utterances；
  // request.corpus.context 是 JSON 字符串，热词为 {"hotwords":[{"word":"…"}]}，
  // 对话上下文为 {"context_type":"dialog_ctx","context_data":[{"text":"…"}]}，两者二选一。
  const extras = input as AsrExtras
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback
  const hotwords = Array.isArray(extras.hotwords)
    ? extras.hotwords.filter((w): w is string => typeof w === 'string' && w !== '')
    : []
  const context = typeof extras.context === 'string' ? extras.context.trim() : ''
  if (hotwords.length && context)
    throw new ProviderError('invalid_input', 'hotwords 与 context 只能二选一')
  const corpusContext = hotwords.length
    ? JSON.stringify({ hotwords: hotwords.map((word) => ({ word })) })
    : context
      ? JSON.stringify({ context_type: 'dialog_ctx', context_data: [{ text: context }] })
      : undefined
  return {
    audio: {
      data: toBase64(loaded.data),
      format,
      ...(format === 'ogg' ? { codec: 'opus' } : {}),
      ...(input.language ? { language: input.language } : {}),
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: flag(extras.itn, true),
      enable_punc: flag(extras.punc, true),
      ...(typeof extras.ddc === 'boolean' ? { enable_ddc: extras.ddc } : {}),
      show_utterances: flag(extras.utterances, true),
      ...(corpusContext ? { corpus: { context: corpusContext } } : {}),
    },
  }
}

/** Parse the flash ASR response into text + timestamped segments. */
export function parseFlashAsr(raw: string, ctx: AdapterContext): ProviderOutput[] {
  if (!raw.trim()) return [{ type: 'text', text: '' }]
  const packet = events(raw)[0]!
  if (packet.code !== undefined && ![0, 20000000].includes(Number(packet.code)))
    throw failure(200, packet.code, packet.message, ctx)
  const result = asJson(packet.result)
  if (typeof result.text !== 'string') throw incomplete('豆包语音返回无效识别文本')
  const segments: TranscriptSegment[] = arr(result.utterances)
    .map(asJson)
    .filter(
      (u) =>
        typeof u.text === 'string' &&
        typeof u.start_time === 'number' &&
        typeof u.end_time === 'number' &&
        (u.end_time as number) > (u.start_time as number),
    )
    .map((u) => ({
      start: (u.start_time as number) / 1000,
      end: (u.end_time as number) / 1000,
      text: (u.text as string).trim(),
    }))
  return [
    { type: 'text', text: result.text },
    ...(segments.length ? [{ type: 'json' as const, value: { segments } }] : []),
  ]
}

/**
 * 同传实现：由 Node 子路径 `@modelbay/doubao-speech/node` 注入。
 *
 * 官方协议要连 WSS 并收发 protobuf，根入口保持运行时无关，所以这里只留一个注入点：
 * 没有注入时 native 操作仍然返回请求计划，注入了就跑真实会话。
 */
export type InterpretationRunner = (ctx: AdapterContext, params: Json) => Promise<Json>

/**
 * 流式识别实现：由 Node 子路径 `@modelbay/doubao-speech/node` 注入。
 *
 * 官方协议要连 WSS 并收发 gzip 二进制帧，根入口保持运行时无关，
 * 所以这里只留一个注入点。
 */
export type AsrRunner = (ctx: AdapterContext, params: Json) => Promise<Json>

export interface DoubaoAdapterOptions {
  /** 同传实现（Node 子路径提供）。 */
  interpretation?: InterpretationRunner
  /** 流式识别实现（Node 子路径提供）。 */
  asr?: AsrRunner
}

/** 声音复刻 / 音色设计的调用入口。 */
export interface DoubaoVoiceApi {
  voiceClone: {
    clone(input: VoiceCloneInput, ctx: AdapterContext): Promise<VoiceCreationResult>
    status(voiceId: string, ctx: AdapterContext): Promise<VoiceCreationResult>
  }
  voiceDesign: {
    design(input: VoiceDesignInput, ctx: AdapterContext): Promise<VoiceCreationResult>
  }
}

export type DoubaoAdapter = PlatformAdapter & DoubaoVoiceApi

async function readAsset(ctx: AdapterContext, ref: AssetRef): Promise<LoadedFile> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets) throw new ProviderError('invalid_input', '识别音频需要宿主提供 files 或 assets')
  return ctx.assets.load(ref.assetId)
}

export function createDoubaoAdapter(
  models: ModelDeclaration[],
  options: DoubaoAdapterOptions = {},
): DoubaoAdapter {
  const adapter: PlatformAdapter & DoubaoVoiceApi = {
    id: 'doubao/speech',
    title: 'Doubao Speech',
    channels: ['doubao-speech'],
    models,
    nativeOperations: [...DOUBAO_NATIVE_OPERATIONS],
    nodeOnly: ['asr'],
    docsUrl:
      'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
    voiceClone: { clone: cloneVoice, status: voiceStatus },
    voiceDesign: { design: designVoice },

    async submit(request: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult> {
      const { capability } = request
      // MCP 传「渠道:渠道内ID」，去掉渠道前缀后才是平台资源 ID
      const model = request.model.replace(/^doubao-speech:/, '')
      const declared = models.find(
        (m) => m.id === model || m.canonicalId === model || m.channels.some((c) => c.id === model),
      )
      if (declared ? !declared.capabilities.includes(capability) : !request.remoteOnly)
        throw new ProviderError('invalid_input', '豆包语音模型不支持该能力')
      // 先本地核对凭证，缺失时不读素材也不联网
      headers(ctx)
      switch (capability) {
        case 'audio.speech':
          return synthesizeSpeech(model, request.input as CapabilityInput<'audio.speech'>, ctx)
        case 'audio.music':
        case 'audio.sfx': {
          const input = request.input as CapabilityInput<'audio.music'>
          const settings = resolveSpeechSettings(ctx, settingsOverrides(input as SpeechExtras))
          const body = buildAudioCreateBody(input, settings, capability)
          const response = await postRaw(ctx, AUDIO_CREATE_PATH, { model, ...body })
          const data = response.decode((raw) =>
            decodeAudioStream(raw, 'audio', ctx, settings, false),
          )
          return {
            state: 'succeeded',
            outputs: [
              {
                type: 'file',
                kind: 'audio',
                mime: settings.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
                name: `doubao.${settings.format}`,
                data,
              },
            ],
          }
        }
        case 'audio.transcribe': {
          const input = request.input as CapabilityInput<'audio.transcribe'>
          const loaded = await readAsset(ctx, input.audio)
          // 格式与大小（含空文件）以模型声明为准
          const problems = mediaRequirementProblems(
            declared?.limits?.media?.audio,
            { mime: loaded.mime, size: loaded.data.length },
            { title: declared?.title ?? model, label: '识别音频', strict: true },
          )
          if (problems.length) throw new ProviderError('invalid_input', problems[0]!)
          const body = buildFlashAsrBody(input, loaded)
          const response = await postRaw(ctx, ASR_FLASH_PATH, body, {
            resource: 'volc.bigasr.auc_turbo',
            asr: true,
          })
          // 平台返回静音状态码时没有识别结果，按空文本成功
          const outputs = response.decode((raw, silent) =>
            silent ? [{ type: 'text' as const, text: '' }] : parseFlashAsr(raw, ctx),
          )
          return { state: 'succeeded', outputs }
        }
        default:
          throw new ProviderError('invalid_input', '豆包语音不支持该能力')
      }
    },

    async native(
      op: string,
      params: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<unknown> {
      if (op === 'simultaneous-interpretation' && options.interpretation) {
        return options.interpretation(ctx, params as Json)
      }
      // 流式识别走 speech_raw_request 的 product=asr_stream / asr_websocket 分支。
      if (op === 'raw-request' && options.asr && isAsrStream(params)) {
        return options.asr(ctx, params as Json)
      }
      return runDoubaoNative(op, params, ctx)
    },
  }
  return defineAdapter(adapter) as DoubaoAdapter
}

/**
 * `speech_raw_request` 里 product=asr_stream / asr_websocket 表示走流式识别。
 *
 * 两者共用同一个 Node 实现，端点由 product / mode 决定。
 */
function isAsrStream(params: Record<string, unknown>): boolean {
  return params.product === 'asr_stream' || params.product === 'asr_websocket'
}

export { nativeOperationSchemas, buildSpeechRequest }
