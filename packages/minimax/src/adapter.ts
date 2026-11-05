/**
 * MiniMax `PlatformAdapter` factory. `defineAdapter()` is applied in `index.ts`.
 * 请求构造、前置校验、响应解析与错误分类与 plein 的 minimax provider 保持一致。
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
  type SubmitResult,
} from '@modelbay/core'
import { chat } from './chat'
import { asJson, errorCode, requestJson } from './http'
import { image } from './image'
import { MINIMAX_NATIVE_OPERATIONS, nativeOperationSchemas, runMinimaxNative } from './native'
import { fromHex, required, taskId, usage } from './util'
import { video } from './video'

const T2A_PATH = '/v1/t2a_v2'
const MUSIC_PATH = '/v1/music_generation'
const QUERY_PATH = '/v2/query/video_generation'
const VIDEO_PATH = '/v2/video_generation'
/** 宿主没有配置默认音色（如 MCP）时的系统音色 */
const DEFAULT_VOICE = 'male-qn-qingse'

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
      const { capability } = request
      const model = request.model.startsWith('minimax:') ? request.model.slice(8) : request.model
      const spec = models.find((m) => m.id === model || m.channels.some((c) => c.id === model))
      // remoteOnly 是宿主核对过覆盖范围后放开的远端新模型：只限对话，不用未确认的能力
      const known = spec?.capabilities.includes(capability as NormalizedCapability)
      if (!known && !(request.remoteOnly && capability === 'text.chat'))
        throw new ProviderError('invalid_input', 'MiniMax 模型与能力不匹配')
      switch (capability) {
        case 'text.chat':
          return chat(request as AdapterRequest<'text.chat'>, model, spec, ctx)
        case 'image.generate':
          return image(request as AdapterRequest<'image.generate'>, model, spec!, ctx)
        case 'video.generate':
          return video(request as AdapterRequest<'video.generate'>, model, spec!, ctx)
        case 'audio.speech': {
          const input = request.input as CapabilityInput<'audio.speech'>
          required(input.text, 9999, '台词')
          if (input.instruction)
            throw new ProviderError(
              'invalid_input',
              'MiniMax 不支持自由语气指令；请通过 extra.emotion 指定官方情绪值，或使用豆包/千问配音',
            )
          const speed = input.speed ?? 1
          if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
            throw new ProviderError('invalid_input', 'MiniMax 语速须为 0.5–2')
          const voice =
            input.voice ||
            (typeof ctx.settings?.voice === 'string' && ctx.settings.voice) ||
            DEFAULT_VOICE
          const data = await requestJson(ctx, T2A_PATH, {
            model,
            text: input.text,
            stream: false,
            output_format: 'hex',
            voice_setting: {
              voice_id: voice,
              speed,
              vol: 1,
              pitch: 0,
              ...(input.extra?.emotion ? { emotion: input.extra.emotion } : {}),
            },
            audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
          })
          const audio = asJson(data.data).audio
          return {
            state: 'succeeded',
            outputs: [
              {
                type: 'file',
                kind: 'audio',
                mime: 'audio/mpeg',
                data: fromHex(typeof audio === 'string' ? audio : '', '音频'),
              },
            ],
            usage: usage(data),
          }
        }
        case 'audio.music': {
          const input = request.input as CapabilityInput<'audio.music'>
          required(input.prompt, 2000, '音乐描述')
          if (input.duration) ctx.log('MiniMax Music 时长由模型决定，duration 不作为接口参数')
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
          return {
            state: 'succeeded',
            outputs: [
              {
                type: 'file',
                kind: 'audio',
                mime: 'audio/mpeg',
                data: fromHex(typeof audio === 'string' ? audio : '', '音乐'),
              },
            ],
          }
        }
        default:
          throw new ProviderError('invalid_input', `MiniMax 不支持 ${capability}`)
      }
    },

    async poll(remoteId: string, ctx: AdapterContext): Promise<PollResult> {
      const id = taskId(remoteId)
      const data = await requestJson(ctx, `${QUERY_PATH}/${id}`)
      const task = asJson(data.task)
      if (!task.id || String(task.id) !== id)
        throw new ProviderError('unknown', 'MiniMax 查询未返回匹配的任务')
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
            message: String(asJson(task.error).message ?? `MiniMax 任务 ${status}`),
            retryable: false,
          },
        }
      if (status !== 'succeeded')
        throw new ProviderError('unknown', 'MiniMax 查询返回了未知的任务状态')
      const url = asJson(task.content).url
      if (typeof url !== 'string' || !url)
        throw new ProviderError('unknown', 'MiniMax 成功任务缺少视频 URL')
      return {
        state: 'succeeded',
        outputs: [{ type: 'file', kind: 'video', mime: 'video/mp4', url }],
        usage: typeof task.duration === 'number' ? { seconds: task.duration } : undefined,
      }
    },

    async cancel(remoteId: string, ctx: AdapterContext): Promise<void> {
      const id = taskId(remoteId)
      const data = await requestJson(ctx, `${QUERY_PATH}/${id}`)
      const task = asJson(data.task)
      if (!task.id || String(task.id) !== id)
        throw new ProviderError('unknown', 'MiniMax 查询未返回匹配的任务，未执行取消')
      // DELETE 也会删除已完成记录，因此仅对排队状态发取消请求。
      if (task.status === 'queued')
        await requestJson(ctx, `${VIDEO_PATH}/${id}`, undefined, { method: 'DELETE' })
    },

    async native(
      op: string,
      params: Record<string, unknown>,
      ctx: AdapterContext,
    ): Promise<unknown> {
      return runMinimaxNative(op, params, ctx, models)
    },
  }
  return defineAdapter(adapter)
}

export { fromHex }
export { nativeOperationSchemas }
