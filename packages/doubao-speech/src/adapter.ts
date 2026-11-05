/**
 * Doubao Speech `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 * Speech synthesis is synchronous (single POST), so `poll` is intentionally absent.
 */
import {
  defineAdapter,
  ProviderError,
  selectDefaultModel,
  toBase64,
  type AdapterContext,
  type AdapterRequest,
  type CapabilityInput,
  type ModelDeclaration,
  type NormalizedCapability,
  type PlatformAdapter,
  type ProviderOutput,
  type SubmitResult,
  type TranscriptSegment,
} from '@modelbay/core'
import { asJson, arr, events, failure, incomplete, postText, type Json } from './http'
import {
  buildSpeechRequest,
  decodeAudioStream,
  resolveSpeechSettings,
  synthesizeSpeech,
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
  const prompt = text(input.prompt, 'Audio prompt', 2971)
  if (
    input.duration !== undefined &&
    (!Number.isFinite(input.duration) || input.duration <= 0 || input.duration > 120)
  )
    throw new ProviderError('invalid_input', 'Audio duration must be >0 and <=120 seconds')
  const lead =
    kind === 'audio.music' ? '仅生成音乐，不要人声对白。' : '仅生成音效，不要音乐或人声对白。'
  const duration =
    input.duration === undefined ? '' : `目标时长 ${Number(input.duration.toFixed(1))} 秒。`
  return {
    text_prompt: text(`${lead}${duration}${prompt}`, 'Full audio prompt'),
    audio_config: { format: settings.format, sample_rate: Number(settings.sampleRate) },
  }
}

/** Build the flash ASR request body from a loaded audio asset. */
export function buildFlashAsrBody(
  input: CapabilityInput<'audio.transcribe'>,
  loaded: { data: Uint8Array; mime: string },
): Json {
  const format = ASR_FORMAT[loaded.mime.toLowerCase()]
  if (!format)
    throw new ProviderError('invalid_input', `Unsupported ASR audio MIME: ${loaded.mime}`)
  if (!loaded.data.length || loaded.data.length > 100 * 1024 * 1024)
    throw new ProviderError('invalid_input', 'ASR audio must be non-empty and within 100 MB')
  return {
    audio: {
      data: toBase64(loaded.data),
      format,
      ...(format === 'ogg' ? { codec: 'opus' } : {}),
      ...(input.language ? { language: input.language } : {}),
    },
    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true },
  }
}

/** Parse the flash ASR response into text + timestamped segments. */
export function parseFlashAsr(raw: string, ctx: AdapterContext): ProviderOutput[] {
  if (!raw.trim()) return [{ type: 'text', text: '' }]
  const packet = events(raw)[0]!
  if (packet.code !== undefined && ![0, 20000000].includes(Number(packet.code)))
    throw failure(200, packet.code, packet.message, ctx)
  const result = asJson(packet.result)
  if (typeof result.text !== 'string') throw incomplete('Doubao returned invalid recognition text')
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
 * 同传实现：由 Node 子路径 `@modelbay/doubao-speech/interpretation` 注入。
 *
 * 官方协议要连 WSS 并收发 protobuf，根入口保持运行时无关，所以这里只留一个注入点：
 * 没有注入时 native 操作仍然返回请求计划，注入了就跑真实会话。
 */
export type InterpretationRunner = (ctx: AdapterContext, params: Json) => Promise<Json>

export interface DoubaoAdapterOptions {
  /** 同传实现（Node 子路径提供）。 */
  interpretation?: InterpretationRunner
}

export function createDoubaoAdapter(
  models: ModelDeclaration[],
  options: DoubaoAdapterOptions = {},
): PlatformAdapter {
  const adapter: PlatformAdapter = {
    id: 'doubao/speech',
    title: 'Doubao Speech',
    channels: ['doubao-speech'],
    models,
    nativeOperations: [...DOUBAO_NATIVE_OPERATIONS],
    nodeOnly: ['asr'],
    docsUrl:
      'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',

    async submit(request: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult> {
      const { capability, model } = request
      switch (capability) {
        case 'audio.speech':
          return synthesizeSpeech(model, request.input as CapabilityInput<'audio.speech'>, ctx)
        case 'audio.music':
        case 'audio.sfx': {
          const input = request.input as CapabilityInput<'audio.music'>
          const settings = resolveSpeechSettings(ctx)
          const body = buildAudioCreateBody(input, settings, capability)
          const raw = await postText(ctx, AUDIO_CREATE_PATH, { model, ...body })
          const data = decodeAudioStream(raw, 'audio', ctx, settings, false)
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
          if (!ctx.assets)
            throw new ProviderError('invalid_input', 'An assets source is required for ASR audio')
          const loaded = await ctx.assets.load(input.audio.assetId)
          const body = buildFlashAsrBody(input, loaded)
          const raw = await postText(ctx, ASR_FLASH_PATH, body, {
            resource: 'volc.bigasr.auc_turbo',
            asr: true,
          })
          return { state: 'succeeded', outputs: parseFlashAsr(raw, ctx) }
        }
        default:
          throw new ProviderError('invalid_input', `Doubao Speech does not support ${capability}`)
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
      return runDoubaoNative(op, params, ctx)
    },
  }
  return defineAdapter(adapter)
}

export { nativeOperationSchemas, buildSpeechRequest }
