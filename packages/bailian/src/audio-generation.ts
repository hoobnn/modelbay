/**
 * 音频生成（qwen-audio-3.1-tts-next）：自然语言描述整段音频，可引用最多 3 段参考音色。
 * 请求体 `{ model, input: { text_prompt, references?, format, sample_rate, … } }`，
 * 同步返回 output.audio.url。上限与可选参数都读声明。
 * 来源：https://help.aliyun.com/zh/model-studio/audio-generation-api（2026-11-11 核对）
 */
import { ProviderError, selectNativeModel, toModelInfo } from '@modelbay/core'
import type { AdapterContext, AssetRef, ModelDeclaration } from '@modelbay/core'
import { resolveAudio } from './asr'
import { asJson, arr, requestJson, type Json } from './http'
import { optionKeys, optionsProblem } from './options'
import { SYNTH_PATH } from './tts'

const AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  pcm: 'audio/pcm',
}

export interface AudioGenerationOptions {
  prompt: string
  references: Array<string | AssetRef>
  model?: string
  /** optionsSchema 里声明的参数（format / sample_rate / rate …） */
  options: Json
  /** 额外的官方 input 字段（不能覆盖 text_prompt / references） */
  parameters?: Json
}

function findModel(models: readonly ModelDeclaration[], requested?: string) {
  const declaration = requested
    ? models.find(
        (item) =>
          item.native?.includes('audio-generation') &&
          item.channels.some(
            (channel) => channel.channel === 'bailian' && channel.id === requested,
          ),
      )
    : selectNativeModel(models, 'audio-generation', 'bailian')?.declaration
  const channel = declaration?.channels.find((item) => item.channel === 'bailian')
  if (!declaration || !channel)
    throw new ProviderError('invalid_input', `${requested || 'audio-generation'} 不是音频生成模型`)
  return toModelInfo(declaration, channel)
}

export async function generateAudio(
  opts: AudioGenerationOptions,
  ctx: AdapterContext,
  models: readonly ModelDeclaration[],
): Promise<Json> {
  const spec = findModel(models, opts.model)
  const limits = spec.limits ?? {}
  if (!opts.prompt.trim()) throw new ProviderError('invalid_input', '音频生成须提供 prompt')
  if (
    limits.promptMaxLength !== undefined &&
    // oxlint-disable-next-line typescript/no-misused-spread -- 平台按 Unicode 码点计字数
    [...opts.prompt].length > limits.promptMaxLength
  )
    throw new ProviderError('invalid_input', `prompt 最多 ${limits.promptMaxLength} 个字符`)
  const maxRefs = limits.references?.max
  if (maxRefs !== undefined && opts.references.length > maxRefs)
    throw new ProviderError('invalid_input', `参考音频最多 ${maxRefs} 段`)
  const names = optionKeys(spec.optionsSchema)
  const unknown = Object.keys(opts.options).filter((key) => !names.includes(key))
  if (unknown.length)
    throw new ProviderError('invalid_input', `${spec.id} 不支持参数：${unknown.join('、')}`)
  if (optionsProblem(spec.optionsSchema, opts.options))
    throw new ProviderError('invalid_input', '音频生成参数无效')
  const extra = { ...opts.parameters }
  if (Object.keys(extra).some((key) => ['text_prompt', 'references'].includes(key)))
    throw new ProviderError('invalid_input', 'parameters 不能覆盖 text_prompt / references')

  const references: Json[] = []
  for (const ref of opts.references) {
    if (typeof ref === 'string' && ref.startsWith('oss://'))
      throw new ProviderError('invalid_input', '参考音频须为公网 URL、Data URI 或本地文件')
    const src = await resolveAudio(ref, ctx)
    references.push(src.startsWith('data:') ? { audio_data: src } : { audio_url: src })
  }
  const input: Json = {
    ...extra,
    text_prompt: opts.prompt,
    ...(references.length ? { references } : {}),
    ...opts.options,
  }
  const data = await requestJson(ctx, SYNTH_PATH, { model: spec.id, input })
  const audio = asJson(asJson(data.output).audio)
  if (typeof audio.url !== 'string' || !audio.url)
    throw new ProviderError('unknown', '百炼没有返回生成的音频')
  // 官方返回的 OSS 链接是 http，同一地址可走 https。
  const url = audio.url.replace(/^http:\/\//i, 'https://')
  // 以实际发出的 input 为准（format 也可能来自 parameters）；官方默认 wav
  const format = typeof input.format === 'string' ? input.format : 'wav'
  return {
    model: spec.id,
    outputs: [
      {
        type: 'file',
        kind: 'audio',
        mime: AUDIO_MIME[format] ?? 'application/octet-stream',
        url,
        name: `audio-generation.${format}`,
      },
    ],
    ...(typeof audio.duration === 'number' ? { duration: audio.duration } : {}),
    ...(typeof audio.expires_at === 'number' ? { expires_at: audio.expires_at } : {}),
    usage: data.usage,
    request_id: data.request_id,
  }
}

/** 把 MCP / native 参数里的 references 数组规整成字符串或素材引用。 */
export function referenceSources(value: unknown): Array<string | AssetRef> {
  return arr(value).map((item) => {
    const ref = asJson(item)
    if (typeof ref.assetId === 'string' && ref.assetId)
      return {
        assetId: ref.assetId,
        kind: 'audio' as const,
        ...(typeof ref.mime === 'string' ? { mime: ref.mime } : {}),
      }
    return typeof item === 'string' ? item : ''
  })
}
