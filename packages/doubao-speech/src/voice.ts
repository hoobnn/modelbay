/**
 * 声音复刻与音色设计（V3 接口）：与 plein 的 `VoiceCloneSpec.clone / status`、
 * `VoiceDesignSpec.design` 等价的调用入口，由桥接层直接包装。
 *
 * 复刻支持两种模式：slot（控制台分配的 `S_` 槽位）与 custom（自定义音色 ID，
 * 后付费协议）；训练状态以 `get_voice` 为准。音色设计支持文字与角色图片。
 */
import { downloadVoicePreview } from '@modelbay/shared'
import {
  mediaRequirementProblems,
  ProviderError,
  toBase64,
  type AdapterContext,
  type AssetRef,
  type LoadedFile,
  type MediaRequirement,
  type VoiceCloneInput,
  type VoiceCloneState,
  type VoiceCreationResult,
  type VoiceDesignInput,
} from '@modelbay/core'
import { asJson, failure, incomplete, isJson, postRaw, scrub, type Json } from './http'
import { GET_VOICE_PATH, VOICE_CLONE_PATH, VOICE_DESIGN_PATH } from './native'
import { customVoiceId, text } from './speech'

/** 复刻样本：平台接受的格式，单个文件 10 MB 以内 */
export const CLONE_FORMATS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
}

/** 复刻样本的要求：格式与单个文件大小；平台建议 14–30 秒，短音频也接受，不按时长拦截 */
export const CLONE_SAMPLE: MediaRequirement = {
  mime: Object.keys(CLONE_FORMATS),
  maxMB: 10,
  minBytes: 1,
}

const SLOT_ID = /^S_[A-Za-z0-9_-]{1,100}$/

/** 优先用宿主的 `ctx.files.read`（带元数据），回退到 `ctx.assets.load`。 */
async function readFile(ctx: AdapterContext, ref: AssetRef): Promise<LoadedFile> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets) throw new ProviderError('invalid_input', '读取素材需要宿主提供 files 或 assets')
  return ctx.assets.load(ref.assetId)
}

/** 复刻接口的响应：HTTP 200 也可能在 code / message 里带错误 */
function cloneBody(raw: string, ctx: AdapterContext): Json {
  let body: Json
  try {
    body = asJson(JSON.parse(raw))
  } catch {
    throw incomplete('豆包语音返回无效 JSON 对象')
  }
  const header = isJson(body.header) ? body.header : body
  if (header.code !== undefined && ![0, 20000000].includes(Number(header.code)))
    throw failure(200, header.code, header.message, ctx)
  return isJson(body.data) ? body.data : body
}

/** 训练状态：0 没找到、1 训练中、2 成功、3 失败、4 已激活（2、4 都能用于合成） */
export function cloneState(raw: string, ctx: AdapterContext): VoiceCloneState {
  const data = cloneBody(raw, ctx)
  const status = Number(data.status)
  if (status === 2 || status === 4) return { status: 'ready' }
  // 0 是没找到：刚提交时平台可能还没登记，提交本身成功过，所以按训练中继续查
  if (status === 0 || status === 1) return { status: 'training' }
  const reason = typeof data.message === 'string' ? scrub(data.message, ctx) : ''
  if (status === 3)
    return { status: 'failed', message: reason || '平台训练失败，请换一段更清晰的样本' }
  throw incomplete('豆包语音返回无效训练状态')
}

async function voiceResult(
  raw: string,
  ctx: AdapterContext,
  pending = false,
): Promise<VoiceCreationResult> {
  const data = cloneBody(raw, ctx)
  const state =
    data.status === undefined && pending ? { status: 'training' as const } : cloneState(raw, ctx)
  if (typeof data.demo_audio !== 'string' || !data.demo_audio) return state
  try {
    const url = new URL(data.demo_audio)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.bytespeech.com')) return state
    return { ...state, preview: await downloadVoicePreview(url.toString(), ctx) }
  } catch {
    ctx.log('音色已提交，试听暂未保存；可刷新状态重试获取试听')
    return state
  }
}

/** 解码在 await 之前完成，失败时仍带上请求 ID 与平台日志 ID。 */
async function decodeVoice(
  response: Awaited<ReturnType<typeof postRaw>>,
  ctx: AdapterContext,
  pending: boolean,
): Promise<VoiceCreationResult> {
  const raw = response.raw
  // 先同步校验响应结构，再下载试听（试听失败不影响音色结果）
  response.decode((value) => {
    if (!(pending && cloneBody(value, ctx).status === undefined)) cloneState(value, ctx)
  })
  return voiceResult(raw, ctx, pending)
}

export async function cloneVoice(
  {
    voiceId,
    sample,
    idMode,
    noiseReduction = false,
    volumeNormalization = false,
    language = 'zh',
    previewText,
    promptSample,
  }: VoiceCloneInput,
  ctx: AdapterContext,
): Promise<VoiceCreationResult> {
  if (promptSample) throw new ProviderError('invalid_input', '豆包不支持 MiniMax 增强参考样本')
  if (previewText && (previewText.length < 4 || previewText.length > 300))
    throw new ProviderError('invalid_input', '豆包复刻试听文本须为 4–300 字')
  if (idMode === 'custom' ? !customVoiceId(voiceId) : !SLOT_ID.test(voiceId))
    throw new ProviderError(
      'invalid_input',
      '请填写有效的音色槽位 ID 或符合官方规则的自定义音色 ID',
    )
  const asset = await readFile(ctx, sample)
  // 格式与大小（含空文件）以样本声明为准
  const problems = mediaRequirementProblems(
    CLONE_SAMPLE,
    { mime: asset.mime, size: asset.data.length },
    { title: '豆包声音复刻', label: '复刻样本', strict: true },
  )
  if (problems.length) throw new ProviderError('invalid_input', problems[0]!)
  const format = CLONE_FORMATS[asset.mime.toLowerCase()]
  if (!format)
    throw new ProviderError('invalid_input', '复刻样本须为 WAV、MP3、OGG、M4A 或 AAC 音频')
  const response = await postRaw(ctx, VOICE_CLONE_PATH, {
    speaker_id: idMode === 'custom' ? 'custom_speaker_id' : voiceId,
    ...(idMode === 'custom' ? { custom_speaker_id: voiceId } : {}),
    language: language === 'en' ? 1 : 0,
    audio: { data: toBase64(asset.data), format },
    extra_params: {
      enable_audio_denoise: noiseReduction,
      disable_volume_normalization: !volumeNormalization,
      ...(previewText ? { demo_text: previewText } : {}),
    },
  })
  // 提交后训练在平台上进行，状态以 get_voice 为准
  return decodeVoice(response, ctx, true)
}

export async function voiceStatus(
  voiceId: string,
  ctx: AdapterContext,
): Promise<VoiceCreationResult> {
  const response = await postRaw(ctx, GET_VOICE_PATH, { speaker_id: voiceId })
  return decodeVoice(response, ctx, false)
}

export async function designVoice(
  { voiceId, prompt, previewText, image, language = 'zh' }: VoiceDesignInput,
  ctx: AdapterContext,
): Promise<VoiceCreationResult> {
  if (!SLOT_ID.test(voiceId))
    throw new ProviderError('invalid_input', '音色设计需要控制台购买的 S_ 音色槽位')
  if (prompt.length > 200 || (!prompt.trim() && !image))
    throw new ProviderError('invalid_input', '请填写 200 字以内的音色描述或提供角色图片')
  text(previewText, '试听文本', 300)
  let imagePrompt: Json | undefined
  if (image) {
    const asset = await readFile(ctx, image)
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime) ||
      !asset.data.length ||
      asset.data.length > 10 * 1024 * 1024
    )
      throw new ProviderError('invalid_input', '角色图片须为 JPEG、PNG 或 WebP，10 MB 以内')
    imagePrompt = { image_bytes: toBase64(asset.data) }
  }
  const response = await postRaw(ctx, VOICE_DESIGN_PATH, {
    speaker_id: voiceId,
    text: previewText,
    language: language === 'en' ? 1 : 0,
    prompt: {
      ...(prompt.trim() ? { text_prompt: prompt } : {}),
      ...(imagePrompt ? { image_prompt: imagePrompt } : {}),
    },
  })
  return decodeVoice(response, ctx, true)
}
