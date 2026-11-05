/**
 * MCP 工具参数 → 归一化能力输入的通用映射。
 *
 * 工具目录沿用各平台原 MCP 的字段名（`prompt`、`history`、`max_tokens`、`voice_id`…），
 * 适配器按 `CapabilityInputs` 的归一化字段读取。这里只做「补」：归一化字段没给时，
 * 从同义的 MCP 字段换算出来；原字段保留，适配器里已有的 MCP 专属处理照常生效。
 * 和具体平台、模型有关的字段不在这里处理。
 */
import { ProviderError } from '@modelbay/core'

type Args = Record<string, unknown>

const has = (value: unknown) => value !== undefined && value !== null

function setIfAbsent(input: Args, key: string, value: unknown): void {
  if (!has(input[key]) && has(value)) input[key] = value
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
  if (typeof prompt === 'string') messages.push({ role: 'user', content: prompt })
  return messages
}

/** 按能力补齐归一化字段；返回新对象，不改入参。 */
export function normalizeArguments(capability: string, args: Args): Args {
  const input: Args = { ...args }
  switch (capability) {
    case 'text.chat':
      if (!Array.isArray(input.messages)) {
        const messages = chatMessages(input)
        if (messages) input.messages = messages
      }
      setIfAbsent(input, 'maxTokens', input.max_tokens)
      break
    case 'audio.speech':
      setIfAbsent(input, 'voice', input.voice_id)
      setIfAbsent(input, 'instruction', input.instructions)
      break
    case 'image.generate':
      setIfAbsent(input, 'negativePrompt', input.negative_prompt)
      setIfAbsent(input, 'count', input.n)
      break
    case 'video.generate':
      setIfAbsent(input, 'aspectRatio', input.ratio ?? input.aspect_ratio)
      break
  }
  return input
}
