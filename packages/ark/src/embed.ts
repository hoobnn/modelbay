/**
 * 方舟多模态向量化（capability `text.embed`，`POST /embeddings/multimodal`）。
 *
 * 字段与取值来自官方文档（2026-11-06 核对原文）：
 * https://docs.volcengine.com/docs/82379/1523520
 * - `input`（必选）：对象列表，`type` 取 `text`、`image_url`、`video_url`；
 *   图片 `image_url.url` 是 URL 或 `data:image/{格式};base64,{编码}`，视频 `video_url.url` 是链接或 Base64，
 *   视频还可带 `fps`、`max_video_tokens`、`min_frame_tokens`、`max_frame_tokens`、`min_frames`。
 * - `dimensions`、`encoding_format`、`instructions`、`multi_embedding`、`sparse_embedding` 的取值范围
 *   写在模型声明的 `optionsSchema` 里，这里不硬编码。
 *
 * 输入有三种写法，必须且只能选一种：`texts`（文本列表）、`contents`（官方 `input` 结构，
 * 也接受 `{text}` / `{image}` / `{video}` 简写）、或按 text → image → video 顺序拼接的 `texts` + `images` + `videos`。
 */
import {
  ProviderError,
  type AdapterContext,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, isJson, request, type Json, type TransportMessages } from './http'
import { optionKeys, validateOptions } from './options'

export interface EmbedCall {
  ctx: AdapterContext
  baseURL: string
  model: string
  apiKey: string
  label: string
  messages: TransportMessages
  input: Record<string, unknown>
  declaration?: ModelDeclaration
  /** 套餐渠道的向量化模型不对 API 调用开放。 */
  plan: boolean
}

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

function strings(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))
    invalid(`${name} 必须是非空字符串列表`)
  return value as string[]
}

/** 官方 `input` 元素原样放行（含视频抽帧参数）；`{text}` / `{image}` / `{video}` 简写换成官方结构。 */
function contentItem(raw: unknown, index: number): Json {
  const item = asJson(raw)
  if (typeof item.type === 'string') {
    const field = item.type
    if (field === 'text' && typeof item.text === 'string') return item
    if (field === 'image_url' && isJson(item.image_url)) return item
    if (field === 'video_url' && isJson(item.video_url)) return item
    invalid(`contents[${index}] 的 type 必须是 text、image_url、video_url，并带对应字段`)
  }
  if (typeof item.text === 'string') return { type: 'text', text: item.text }
  if (typeof item.image === 'string') return { type: 'image_url', image_url: { url: item.image } }
  if (typeof item.video === 'string') return { type: 'video_url', video_url: { url: item.video } }
  return invalid(`contents[${index}] 须是官方 input 结构，或 {text} / {image} / {video}`)
}

/** 本地路径不读取：图片、视频只收公网 URL 或 Base64。 */
function mediaItem(url: string, type: 'image_url' | 'video_url'): Json {
  if (!/^(https?:\/\/|data:)/i.test(url))
    invalid('图片、视频须是公网 URL 或 Base64 Data URI，不读取本地路径')
  return { type, [type]: { url } }
}

export function embedInput(input: Record<string, unknown>): Json[] {
  // `input.input` 是 core 归一化输入里的文本列表，当作 texts
  const texts = strings(input.texts ?? input.input, 'texts')
  const images = strings(input.images, 'images')
  const videos = strings(input.videos, 'videos')
  const contents = Array.isArray(input.contents) ? input.contents : []
  if (input.contents !== undefined && input.contents !== null && !Array.isArray(input.contents))
    invalid('contents 必须是列表')
  const plain = texts.length + images.length + videos.length
  if (contents.length && plain) invalid('contents 与 texts / images / videos 只能选一种')
  if (!contents.length && !plain) invalid('需要提供 texts、contents，或 images / videos')
  if (contents.length) return contents.map(contentItem)
  return [
    ...texts.map((text): Json => ({ type: 'text', text })),
    ...images.map((url) => mediaItem(url, 'image_url')),
    ...videos.map((url) => mediaItem(url, 'video_url')),
  ]
}

export async function embed(call: EmbedCall): Promise<SubmitResult> {
  const { ctx, label } = call
  if (call.plan) invalid('套餐渠道的向量化模型不对 API 调用开放，请使用按量渠道')
  if (!call.model) invalid('向量化请显式指定 model，例如 doubao-embedding-vision')
  const extra = asJson(call.input.extra)
  const declared = optionKeys(call.declaration)
  for (const key of Object.keys(extra))
    if (!declared.includes(key))
      invalid(`火山方舟向量化不支持 extra.${key}；不能覆盖模型、输入或请求路由`)
  validateOptions(call.declaration, extra)
  const data = await request({
    ctx,
    url: `${call.baseURL}/embeddings/multimodal`,
    method: 'POST',
    headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...extra, model: call.model, input: embedInput(call.input) }),
    label,
    messages: call.messages,
    secrets: [call.apiKey],
    retries: 0,
  })
  if (data.data === undefined) throw new ProviderError('unknown', `${label}响应缺少向量数据`)
  const usage = asJson(data.usage)
  return {
    state: 'succeeded',
    outputs: [
      {
        type: 'json',
        value: { id: data.id, model: data.model, data: data.data, usage: data.usage },
      },
    ],
    usage: {
      ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
    },
  }
}
