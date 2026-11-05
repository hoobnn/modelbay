/**
 * MCP 工具参数 → 归一化能力输入的通用映射。
 *
 * 工具目录沿用各平台原 MCP 的字段名（`prompt`、`history`、`max_tokens`、`voice_id`…），
 * 适配器按 `CapabilityInputs` 的归一化字段读取。这里只做「补」：归一化字段没给时，
 * 从同义的 MCP 字段换算出来；原字段保留，适配器里已有的 MCP 专属处理照常生效。
 * 和具体平台、模型有关的字段不在这里处理。
 */
import { ProviderError } from '@modelbay/core'
import type { AssetRef } from '@modelbay/core'
import { mimeFromName } from './assets'

type Args = Record<string, unknown>
type Kind = 'image' | 'video' | 'audio'

const has = (value: unknown) => value !== undefined && value !== null

function setIfAbsent(input: Args, key: string, value: unknown): void {
  if (!has(input[key]) && has(value)) input[key] = value
}

/** 路径 / URL → AssetRef；种类由参数本身决定。 */
function asset(value: unknown, kind: Kind, field: string): AssetRef {
  if (typeof value !== 'string' || !value.trim())
    throw new ProviderError('invalid_input', `${field} 须为本地路径或 URL`)
  const mime = mimeFromName(value)
  return { assetId: value, kind, ...(mime ? { mime } : {}) }
}

function assets(value: unknown, kind: Kind, field: string): AssetRef[] {
  if (!has(value)) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => asset(item, kind, field))
}

function chatMessages(args: Args): unknown[] | undefined {
  const prompt = args.prompt
  const history = args.history
  const system = args.system
  if (!has(prompt) && !has(history)) return undefined
  if (has(history) && !Array.isArray(history))
    throw new ProviderError('invalid_input', 'history 须为消息数组')
  const messages: unknown[] = []
  if (typeof system === 'string' && system.trim())
    messages.push({ role: 'system', content: system })
  for (const item of (history as unknown[] | undefined) ?? []) {
    const message = item as { role?: unknown; content?: unknown }
    if (typeof message?.role !== 'string' || !has(message.content))
      throw new ProviderError('invalid_input', 'history 里的每条消息都需要 role 和 content')
    messages.push({ role: message.role, content: message.content })
  }
  const images = assets(args.images, 'image', 'images')
  if (images.length)
    messages.push({
      role: 'user',
      content: [
        ...(typeof prompt === 'string' && prompt ? [{ type: 'text', text: prompt }] : []),
        ...images.map((image) => ({ type: 'image', image })),
      ],
    })
  else if (typeof prompt === 'string') messages.push({ role: 'user', content: prompt })
  return messages
}

/** 按能力补齐归一化字段；返回新对象，不改入参。 */
export function normalizeArguments(capability: string, args: Args): Args {
  const input: Args = { ...args }
  switch (capability) {
    case 'text.chat':
      if (!Array.isArray(input.messages)) {
        if (has(input.images) && !has(input.prompt))
          throw new ProviderError('invalid_input', 'images 需要同时提供 prompt')
        const messages = chatMessages(input)
        if (messages) input.messages = messages
      }
      setIfAbsent(input, 'maxTokens', input.max_tokens)
      break
    case 'audio.speech':
      setIfAbsent(input, 'voice', input.voice_id)
      setIfAbsent(input, 'instruction', input.instructions)
      break
    case 'image.generate': {
      setIfAbsent(input, 'negativePrompt', input.negative_prompt)
      setIfAbsent(input, 'count', input.n)
      const references = assets(input.images, 'image', 'images')
      if (references.length) setIfAbsent(input, 'references', references)
      break
    }
    case 'video.generate': {
      setIfAbsent(input, 'aspectRatio', input.ratio ?? input.aspect_ratio)
      if (has(input.first_frame))
        setIfAbsent(input, 'firstFrame', asset(input.first_frame, 'image', 'first_frame'))
      if (has(input.last_frame))
        setIfAbsent(input, 'lastFrame', asset(input.last_frame, 'image', 'last_frame'))
      const references = [
        ...assets(input.reference_images, 'image', 'reference_images'),
        ...assets(input.reference_videos, 'video', 'reference_videos'),
        ...assets(input.reference_audios, 'audio', 'reference_audios'),
      ]
      if (references.length) setIfAbsent(input, 'references', references)
      break
    }
    case 'audio.transcribe':
      if (typeof input.audio === 'string') input.audio = asset(input.audio, 'audio', 'audio')
      break
  }
  return input
}
