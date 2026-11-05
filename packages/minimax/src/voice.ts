/**
 * 声音复刻 / 音色设计（plein `VoiceCloneSpec.clone` / `VoiceDesignSpec.design` 等价入口）。
 * 复刻是同步接口：上传样本拿 file_id，再提交复刻，成功即可用；增强参考单独上传为 prompt_audio。
 */
import {
  ProviderError,
  type AdapterContext,
  type LoadedFile,
  type VoiceCloneInput,
  type VoiceCloneSpec,
  type VoiceCreationResult,
  type VoiceDesignInput,
  type VoiceDesignSpec,
} from '@modelbay/core'
import { downloadVoicePreview } from '@modelbay/shared'
import { withFiles } from './files'
import { requestJson } from './http'

const MB = 1024 * 1024

/** 复刻样本可接受的格式与上传时的扩展名 */
const CLONE_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
}

/** 试听合成用的模型（与复刻声明的 previewModel 一致） */
export const VOICE_PREVIEW_MODEL = 'speech-2.8-hd'

const HEX = /^(?:[a-f\d]{2})+$/i

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function required(value: string, max: number, label: string) {
  if (!value.trim() || value.length > max)
    throw new ProviderError('invalid_input', `${label}须为 1–${max} 字符`)
}

const sensitive = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? (value as { type?: number }).type !== 0
    : value === true

async function clonePreview(value: unknown, ctx: AdapterContext) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    return await downloadVoicePreview(url.toString(), ctx)
  } catch {
    ctx.log('音色已创建，试听暂未保存；请在平台核查，避免重复创建')
    return undefined
  }
}

async function uploadSample(
  ctx: AdapterContext,
  purpose: 'voice_clone' | 'prompt_audio',
  asset: LoadedFile,
  name: string,
  ext: string,
  failure: string,
) {
  const form = new FormData()
  form.set('purpose', purpose)
  form.set('file', new Blob([new Uint8Array(asset.data)], { type: asset.mime }), `${name}.${ext}`)
  const uploaded = await requestJson(ctx, '/v1/files/upload', form)
  const fileId = (uploaded.file as { file_id?: unknown } | undefined)?.file_id
  // file_id 是 int64，超出 JS 安全整数时 JSON 解析已丢精度，不能拿去提交
  if (
    (typeof fileId !== 'string' && typeof fileId !== 'number') ||
    (typeof fileId === 'number' && !Number.isSafeInteger(fileId))
  )
    throw new ProviderError('unknown', failure)
  return fileId
}

export async function cloneVoice(
  {
    voiceId,
    sample,
    noiseReduction = false,
    volumeNormalization = false,
    previewText,
    promptSample,
    promptText,
  }: VoiceCloneInput,
  adapterCtx: AdapterContext,
): Promise<VoiceCreationResult> {
  const ctx = withFiles(adapterCtx)
  if (!ctx.files) throw new ProviderError('invalid_input', '需要宿主注入 files 才能读取复刻样本')
  const asset = await ctx.files.read(sample)
  const ext = CLONE_FORMATS[asset.mime.toLowerCase()]
  if (!ext) throw new ProviderError('invalid_input', '复刻样本须为 MP3、M4A 或 WAV 音频')
  if (!asset.data.length || asset.data.length > 20 * MB)
    throw new ProviderError('invalid_input', '复刻样本须在 20 MB 以内')
  if (
    asset.duration !== undefined &&
    (!Number.isFinite(asset.duration) || asset.duration < 10 || asset.duration > 300)
  )
    throw new ProviderError('invalid_input', '复刻样本须为 10 秒至 5 分钟')
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId))
    throw new ProviderError('invalid_input', '音色 ID 须为 8–256 位，字母开头，末尾为字母或数字')
  if (previewText && previewText.length > 1000)
    throw new ProviderError('invalid_input', '试听文本须在 1000 字以内')
  if (!!promptSample !== !!promptText?.trim())
    throw new ProviderError('invalid_input', '增强参考音频和对应文字须同时提供')
  let promptAsset: LoadedFile | undefined
  if (promptSample) {
    promptAsset = await ctx.files.read(promptSample)
    if (
      !CLONE_FORMATS[promptAsset.mime.toLowerCase()] ||
      !promptAsset.data.length ||
      promptAsset.data.length > 20 * MB ||
      (promptAsset.duration !== undefined &&
        (!Number.isFinite(promptAsset.duration) ||
          promptAsset.duration <= 0 ||
          promptAsset.duration >= 8))
    )
      throw new ProviderError(
        'invalid_input',
        '增强参考须为小于 8 秒的 MP3、M4A 或 WAV，20 MB 以内',
      )
  }
  const fileId = await uploadSample(
    ctx,
    'voice_clone',
    asset,
    'sample',
    ext,
    'MiniMax 上传样本后没有返回可用的文件 ID',
  )
  let clonePrompt: { prompt_audio: string | number; prompt_text: string } | undefined
  if (promptAsset) {
    const promptId = await uploadSample(
      ctx,
      'prompt_audio',
      promptAsset,
      'prompt',
      CLONE_FORMATS[promptAsset.mime.toLowerCase()]!,
      'MiniMax 没有返回可用的增强参考文件 ID',
    )
    clonePrompt = { prompt_audio: promptId, prompt_text: promptText! }
  }
  const result = await requestJson(ctx, '/v1/voice_clone', {
    file_id: fileId,
    voice_id: voiceId,
    need_noise_reduction: noiseReduction,
    need_volume_normalization: volumeNormalization,
    ...(clonePrompt ? { clone_prompt: clonePrompt } : {}),
    ...(previewText ? { text: previewText, model: VOICE_PREVIEW_MODEL } : {}),
  })
  if (sensitive(result.input_sensitive))
    throw new ProviderError('content_policy', 'MiniMax 内容审核未通过，换一段样本再试')
  if ((result.base_resp as { status_code?: unknown } | undefined)?.status_code !== 0)
    throw new ProviderError('unknown', 'MiniMax 复刻响应缺少成功状态；请先在平台核查音色 ID', {
      outcome: 'unknown',
    })
  const preview = await clonePreview(result.demo_audio, ctx)
  return { status: 'ready', ...(preview ? { preview } : {}) }
}

export async function designVoice(
  { voiceId, prompt, previewText, image }: VoiceDesignInput,
  ctx: AdapterContext,
): Promise<VoiceCreationResult> {
  if (image) throw new ProviderError('invalid_input', 'MiniMax 音色设计仅支持文字描述')
  required(prompt, 2000, '音色描述')
  required(previewText, 500, '试听文本')
  const result = await requestJson(ctx, '/v1/voice_design', {
    voice_id: voiceId,
    prompt,
    preview_text: previewText,
  })
  if (typeof result.voice_id !== 'string' || !result.voice_id)
    throw new ProviderError(
      'unknown',
      'MiniMax 音色设计未返回音色 ID；请先在平台核查，避免重复创建',
      {
        outcome: 'unknown',
      },
    )
  const audio = result.trial_audio
  return {
    status: 'ready',
    voiceId: result.voice_id,
    ...(typeof audio === 'string' && HEX.test(audio)
      ? { preview: { data: hexBytes(audio), mime: 'audio/mpeg' } }
      : {}),
  }
}

/** 与 plein `voiceClone` 声明等价：桥接包装时把 clone 的 ctx 换成 AdapterContext 即可。 */
export const minimaxVoiceClone: VoiceCloneSpec<AdapterContext> = {
  voiceId: 'generated',
  promptSample: true,
  previewModel: VOICE_PREVIEW_MODEL,
  hint: '需要先在 MiniMax 完成实名认证。样本 10 秒至 5 分钟、单人清晰，MP3 / M4A / WAV，20 MB 以内；复刻出的音色 7 天内没用于正式合成会被平台删除',
  clone: cloneVoice,
}

/** 与 plein `voiceDesign` 声明等价。 */
export const minimaxVoiceDesign: VoiceDesignSpec<AdapterContext> = {
  voiceId: 'generated',
  hint: '用文字描述设计新音色，无需音频样本；试听合成会计费。',
  maxPromptLength: 2000,
  maxPreviewLength: 500,
  design: designVoice,
}
