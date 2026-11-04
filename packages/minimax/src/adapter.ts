/**
 * MiniMax `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 */
import {
  defineAdapter,
  ProviderError,
  selectDefaultModel,
  type AdapterContext,
  type AdapterRequest,
  type CapabilityInput,
  type ModelDeclaration,
  type NormalizedCapability,
  type PlatformAdapter,
  type PollResult,
  type ProviderOutput,
  type ProviderUsage,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, arr, errorCode, requestJson, type Json } from './http'
import { MINIMAX_NATIVE_OPERATIONS, nativeOperationSchemas, runMinimaxNative } from './native'

const CHAT_PATH = '/v1/chat/completions'
const IMAGE_PATH = '/v1/image_generation'
const VIDEO_PATH = '/v2/video_generation'
const T2A_PATH = '/v1/t2a_v2'
const MUSIC_PATH = '/v1/music_generation'
const QUERY_PATH = '/v2/query/video_generation'

/** Decode a hex-encoded audio payload without Node's Buffer. */
export function fromHex(text: string): Uint8Array {
  if (!text || !/^(?:[a-f\d]{2})+$/i.test(text))
    throw new ProviderError('unknown', 'MiniMax response has no valid hex audio')
  const bytes = new Uint8Array(text.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function usage(data: Json): ProviderUsage {
  const u = asJson(data.usage)
  const extra = asJson(data.extra_info)
  return {
    ...(typeof u.prompt_tokens === 'number' ? { inputTokens: u.prompt_tokens } : {}),
    ...(typeof u.completion_tokens === 'number' ? { outputTokens: u.completion_tokens } : {}),
    ...(typeof extra.usage_characters === 'number' ? { characters: extra.usage_characters } : {}),
    ...(typeof extra.audio_length === 'number' ? { seconds: extra.audio_length / 1000 } : {}),
  }
}

function sensitive(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    ? (value as { type?: number }).type !== 0
    : value === true
}

function required(value: string, max: number, label: string): void {
  if (!value.trim() || value.length > max)
    throw new ProviderError('invalid_input', `${label} must be 1-${max} characters`)
}

function taskId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new ProviderError('unknown', 'MiniMax submission is missing task_id')
  const id = String(value)
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(id))
    throw new ProviderError('invalid_input', 'Invalid MiniMax task ID')
  return id
}

/** Select the default model via core (only `active` declarations are eligible). */
export function defaultModel(
  models: readonly ModelDeclaration[],
  capability: NormalizedCapability,
  channel = 'minimax',
): string | null {
  return selectDefaultModel(models, capability, channel)?.channel.id ?? null
}

export function createMinimaxAdapter(models: ModelDeclaration[]): PlatformAdapter {
  const adapter: PlatformAdapter = {
    id: 'minimax/api',
    title: 'MiniMax',
    channels: ['minimax'],
    models,
    nativeOperations: [...MINIMAX_NATIVE_OPERATIONS],
    docsUrl: 'https://platform.minimax.cn/docs/api-reference/api-overview',

    async submit(request: AdapterRequest, ctx: AdapterContext): Promise<SubmitResult> {
      const { capability, model } = request
      switch (capability) {
        case 'text.chat': {
          const input = request.input as CapabilityInput<'text.chat'>
          const messages = input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
          const body: Json = {
            model,
            messages,
            stream: false,
            reasoning_split: true,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
            ...(input.maxTokens !== undefined ? { max_completion_tokens: input.maxTokens } : {}),
            ...(input.jsonSchema
              ? {
                  messages: [
                    {
                      role: 'system',
                      content: `Return only valid JSON matching this schema: ${JSON.stringify(input.jsonSchema)}`,
                    },
                    ...messages,
                  ],
                }
              : {}),
            ...input.extra,
          }
          const data = await requestJson(ctx, CHAT_PATH, body)
          if (sensitive(data.input_sensitive) || sensitive(data.output_sensitive))
            throw new ProviderError('content_policy', 'MiniMax content filter rejected the request')
          const choice = asJson(arr(data.choices)[0])
          if (choice.finish_reason === 'content_filter')
            throw new ProviderError(
              'content_policy',
              'MiniMax content filter rejected the response',
            )
          const text = asJson(choice.message).content
          if (typeof text !== 'string' || !text)
            throw new ProviderError('unknown', 'MiniMax chat response has no text')
          const outputs: ProviderOutput[] = input.jsonSchema
            ? [{ type: 'json', value: JSON.parse(text) }]
            : [{ type: 'text', text }]
          return { state: 'succeeded', outputs, usage: usage(data) }
        }
        case 'image.generate': {
          const input = request.input as CapabilityInput<'image.generate'>
          required(input.prompt, 1500, 'Image prompt')
          const n = input.count ?? 1
          if (!Number.isInteger(n) || n < 1 || n > 9)
            throw new ProviderError('invalid_input', 'MiniMax image count must be 1-9')
          const body: Json = {
            model,
            prompt: input.prompt,
            n,
            response_format: 'url',
            aspect_ratio: input.width === undefined ? '1:1' : undefined,
            width: input.width,
            height: input.height,
            ...(input.seed !== undefined ? { seed: input.seed } : {}),
            ...input.extra,
          }
          const data = await requestJson(ctx, IMAGE_PATH, body)
          const urls = asJson(data.data).image_urls
          if (!Array.isArray(urls) || !urls.length)
            throw new ProviderError('unknown', 'MiniMax response has no images')
          return {
            state: 'succeeded',
            outputs: urls
              .filter((url): url is string => typeof url === 'string')
              .map((url) => ({ type: 'file', kind: 'image', mime: 'image/jpeg', url })),
            usage: { images: urls.length },
          }
        }
        case 'video.generate': {
          const input = request.input as CapabilityInput<'video.generate'>
          required(input.prompt, 7000, 'Video prompt')
          const duration = input.duration ?? 5
          if (!Number.isInteger(duration) || duration < 4 || duration > 15)
            throw new ProviderError('invalid_input', 'H3 duration must be a 4-15 second integer')
          const resolution = input.resolution ?? '768P'
          const ratio = input.aspectRatio === 'auto' ? 'adaptive' : (input.aspectRatio ?? '16:9')
          const body: Json = {
            model,
            content: [{ type: 'text', text: input.prompt }],
            duration,
            resolution,
            ratio,
            ...input.extra,
          }
          const data = await requestJson(ctx, VIDEO_PATH, body)
          return { state: 'pending', remoteId: taskId(data.task_id), pollAfterMs: 10_000 }
        }
        case 'audio.speech': {
          const input = request.input as CapabilityInput<'audio.speech'>
          required(input.text, 9999, 'Speech text')
          const speed = input.speed ?? 1
          if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
            throw new ProviderError('invalid_input', 'MiniMax speech rate must be 0.5-2')
          const data = await requestJson(ctx, T2A_PATH, {
            model,
            text: input.text,
            stream: false,
            output_format: 'hex',
            voice_setting: {
              voice_id: input.voice ?? 'male-qn-qingse',
              speed,
              vol: 1,
              pitch: 0,
              ...(input.extra?.emotion ? { emotion: input.extra.emotion } : {}),
            },
            audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
            ...input.extra,
          })
          const audio = asJson(data.data).audio
          if (typeof audio !== 'string')
            throw new ProviderError('unknown', 'MiniMax response has no audio')
          return {
            state: 'succeeded',
            outputs: [{ type: 'file', kind: 'audio', mime: 'audio/mpeg', data: fromHex(audio) }],
            usage: usage(data),
          }
        }
        case 'audio.music': {
          const input = request.input as CapabilityInput<'audio.music'>
          required(input.prompt, 2000, 'Music prompt')
          const data = await requestJson(ctx, MUSIC_PATH, {
            model,
            prompt: input.prompt,
            lyrics: '',
            is_instrumental: true,
            stream: false,
            output_format: 'hex',
            audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 256000 },
          })
          const audio = asJson(data.data).audio
          if (typeof audio !== 'string')
            throw new ProviderError('unknown', 'MiniMax response has no music')
          return {
            state: 'succeeded',
            outputs: [{ type: 'file', kind: 'audio', mime: 'audio/mpeg', data: fromHex(audio) }],
          }
        }
        default:
          throw new ProviderError('invalid_input', `MiniMax does not support ${capability}`)
      }
    },

    async poll(remoteId: string, ctx: AdapterContext): Promise<PollResult> {
      const id = taskId(remoteId)
      const data = await requestJson(ctx, `${QUERY_PATH}/${id}`)
      const task = asJson(data.task)
      if (!task.id || String(task.id) !== id)
        throw new ProviderError('unknown', 'MiniMax query did not return a matching task')
      const status = task.status
      if (status === 'queued' || status === 'running')
        return { state: 'pending', pollAfterMs: 10_000, remote: status }
      if (status === 'failed' || status === 'cancelled')
        return {
          state: 'failed',
          error: {
            code:
              status === 'cancelled'
                ? 'cancelled'
                : errorCode(String(asJson(task.error).type ?? '')),
            message: String(asJson(task.error).message ?? `MiniMax task ${status}`),
            retryable: false,
          },
        }
      const url = asJson(task.content).url
      if (typeof url !== 'string' || !url)
        throw new ProviderError('unknown', 'MiniMax succeeded task has no video URL')
      return {
        state: 'succeeded',
        outputs: [{ type: 'file', kind: 'video', mime: 'video/mp4', url }],
        usage: typeof task.duration === 'number' ? { seconds: task.duration } : undefined,
      }
    },

    async cancel(remoteId: string, ctx: AdapterContext): Promise<void> {
      const id = taskId(remoteId)
      const data = await requestJson(ctx, `${QUERY_PATH}/${id}`)
      const status = asJson(data.task).status
      // DELETE also removes finished records, so only queued tasks are cancelled.
      if (status === 'queued')
        await requestJson(ctx, `${VIDEO_PATH}/${id}`, undefined, { method: 'DELETE' })
    },

    async native(
      op: string,
      params: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<unknown> {
      return runMinimaxNative(op, params, ctx)
    },
  }
  return defineAdapter(adapter)
}

export { nativeOperationSchemas }
