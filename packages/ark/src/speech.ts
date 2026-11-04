/**
 * Ark Agent Plan reuses Doubao Speech for TTS — the only cross-adapter
 * dependency allowed by the contract (ark → doubao-speech). The dependency is
 * imported statically now that `@modelbay/doubao-speech` publishes a stable
 * root entry; a dynamic specifier would bypass Vite's alias and fall back to
 * an unresolvable `dist` during tests.
 */
import { synthesizeSpeech } from '@modelbay/doubao-speech'
import type { AdapterContext, CapabilityInput, SubmitResult } from '@modelbay/core'

/** Synthesize speech for the `doubao-seed-tts-2.0` Agent Plan model. */
export function synthesizePlanSpeech(
  input: CapabilityInput<'audio.speech'>,
  ctx: AdapterContext,
): Promise<SubmitResult> {
  return synthesizeSpeech('seed-tts-2.0', input, ctx, true)
}
