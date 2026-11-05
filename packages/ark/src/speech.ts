/**
 * Ark Agent Plan reuses Doubao Speech for TTS — the only cross-adapter
 * dependency allowed by the contract (ark → doubao-speech). The dependency is
 * imported statically now that `@modelbay/doubao-speech` publishes a stable
 * root entry; a dynamic specifier would bypass Vite's alias and fall back to
 * an unresolvable `dist` during tests.
 */
import { synthesizeSpeech } from '@modelbay/doubao-speech'
import type { AdapterContext, CapabilityInput, SubmitResult } from '@modelbay/core'

const SPEECH_ENV = ['VOLC_SPEECH_VOICE', 'VOLC_SPEECH_FORMAT', 'VOLC_SPEECH_SAMPLE_RATE']

/**
 * Synthesize speech for the `doubao-seed-tts-2.0` Agent Plan model.
 *
 * 套餐 TTS 只认套餐专属 Key：把 `VOLC_SPEECH_API_KEY` 指到 `ARK_AGENT_PLAN_API_KEY`，
 * 豆包语音自己的 Key 不会被带进套餐请求。其余密钥一律隐藏；
 * 宿主给了 `ctx.settings` 时音色 / 格式 / 采样率走 settings，没有 settings（MCP / CLI）时才读 env。
 */
export function synthesizePlanSpeech(
  input: CapabilityInput<'audio.speech'>,
  ctx: AdapterContext,
): Promise<SubmitResult> {
  const scoped: AdapterContext = {
    ...ctx,
    secret: (name) =>
      name === 'VOLC_SPEECH_API_KEY'
        ? ctx.secret('ARK_AGENT_PLAN_API_KEY')
        : !ctx.settings && SPEECH_ENV.includes(name)
          ? ctx.secret(name)
          : undefined,
  }
  return synthesizeSpeech('seed-tts-2.0', input, scoped, true)
}
