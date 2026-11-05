# @modelbay/doubao-speech

Doubao Speech adapter for [Modelbay](../../README.md). MIT licensed.

```ts
import { doubaoAdapter } from '@modelbay/doubao-speech'
import { createAdapterContext } from '@modelbay/core'

const ctx = createAdapterContext({
  secrets: { DOUBAO_APP_ID: '...', DOUBAO_ACCESS_TOKEN: '...' },
})
const result = await doubaoAdapter.submit(
  { capability: 'audio.speech', model: 'seed-tts-2.0', input: { text: '你好' } },
  ctx,
)
```

Only `ctx.fetch` and `ctx.secret` are used. Canonical credential names (injected by the
`modelbay` entry / CLI) are `DOUBAO_APP_ID` + `DOUBAO_ACCESS_TOKEN` for the legacy
`X-Api-App-Key` / `X-Api-Access-Key` pair, or `DOUBAO_API_KEY` for the modern
`X-Api-Key`. The upstream aliases `VOLC_SPEECH_API_KEY`, `VOLC_SPEECH_APP_ID`,
`VOLC_SPEECH_ACCESS_TOKEN` and `VOLC_SPEECH_ACCESS_KEY` are also accepted so existing
hosts keep working. Host-managed configuration may be supplied as `VOLC_SPEECH_VOICE`,
`VOLC_SPEECH_FORMAT` and `VOLC_SPEECH_SAMPLE_RATE` (defaults are in `speechSettings`).
No key is stored and no `console.*` is emitted.

## Cross-adapter API (ark -> doubao-speech)

This is the only allowed cross-adapter dependency. The root entry exports:

- `speechSettings` — a zod object (`.shape` / `.parse`) with the TTS defaults.
- `synthesizeSpeech(model, input, ctx, plan?)` — synchronous `Promise<SubmitResult>`;
  `plan=true` selects `/api/v3/plan/tts/unidirectional` for Ark Agent Plan TTS.
- `TTS_VOICES` — `VoicePreset[]` for speech synthesis 2.0.

## Capabilities

`submit` handles `audio.speech` (unidirectional HTTP), `audio.music` / `audio.sfx`
(Seed Audio `/api/v3/tts/create`), and `audio.transcribe` (flash `/api/v3/auc/bigmodel/recognize/flash`
with `X-Api-Sequence: -1`). Responses are chunked JSON streams: adjacent or
newline-delimited objects carrying base64 audio, decoded without `Buffer`. Speech
synthesis is synchronous, so `poll` is intentionally not implemented (no pending tasks).

## Native operations

Declared in `DOUBAO_NATIVE_OPERATIONS`; each op's input JSON Schema is declared by the
adapter in `nativeOperationSchemas` (for the MCP generator). M3 baseline:

- `podcast` — `POST /api/v3/podcast/sse` (validated request + SSE event parsing)
- `simultaneous-interpretation` — **request plan only**: the official protocol is
  WSS + protobuf (`wss://openspeech.bytedance.com/api/v4/ast/v2/translate`), which
  `ctx.fetch` cannot carry. The op returns the connection headers, the protobuf event
  numbers, the `TranslateRequest` start body and the 80 ms audio chunking rule, so the
  host only has to supply a binary WebSocket and a protobuf codec.

Also implemented: `translation` (`matx_translate`), `meeting-notes` (lark submit/query),
`hotword-table` (`/api/proxy/invoke`), `voice-clone` / `voice-design` / `voice-query`,
`raw-request`, and `console-management` (HMAC-SHA256 signed with the IAM
`VOLC_ACCESS_KEY_ID` / `VOLC_SECRET_ACCESS_KEY` pair — `signedHeaders()`,
`CONSOLE_VERSIONS` and `consoleRoute()` are exported for hosts that need to sign
their own requests; there is no API-Key fallback).

## Realtime session

`session.ts` implements the official JSON-over-WebSocket dialogue protocol — deliberately
**not** modelled as submit/poll. `createRealtimeEvent()` builds the `session.create`
event with the official defaults (input audio 16000 Hz `pcm` / `speech_opus`, output
audio 24000 Hz `pcm` / `pcm_s16le` / `ogg_opus` plus a required voice) and validates
the model number per mode (`legacy` = `1.2.6.1`, `seed` = `1.3.0.0`); video input goes
through `extension.video` and is only allowed in `seed` mode.

`openRealtimeSession()` sends that event, waits for the `session.created` ack before
handing the session over, and then exposes the event stream through
`receive()` / `parseRealtimeEvent()`. The WebSocket comes from `ws` (MIT), an
**optional peer dependency**; hosts that already own a socket can pass their own
factory as the third argument instead. `InMemoryRealtimeSession` stays available for
tests and for hosts without a socket.

## Node-only subpath

`@modelbay/doubao-speech/asr` exports the `node:zlib`-based streaming ASR frame codec
(`encodeAsrFrame` / `decodeAsrFrame`). It is excluded from the root entry. Wiring it to
a real WebSocket session is a TODO (see `nodeAsrTodo`).

`@modelbay/doubao-speech/interpretation` exports the simultaneous-interpretation
client: the minimal protobuf codec for the official `data.speech.ast` messages
(`encodeTranslateRequest` / `decodeTranslateResponse`) and `interpretAudio()`, which
opens the WSS session, uploads the PCM in 80 ms chunks and collects the subtitles,
the target audio and the billing usage.

The root entry stays runtime-agnostic, so the MCP loads this subpath and injects
`interpretAudio` into the adapter (`createDoubaoAdapter(models, { interpretation })`).
Without an injected implementation the native operation still returns the request
plan. The WebSocket comes from `ws` (MIT), an **optional peer dependency**; hosts can
also pass their own socket factory as the third argument of `interpretAudio`.

## Errors and redaction

All failures are `ProviderError`; the raw upstream code/message is kept in
`error.cause` with credentials scrubbed. POST submissions are never retryable and
truncated chunked streams are flagged `outcome: 'unknown'`. Recorded fixtures under
`test/fixtures/` have `X-Api-Key` replaced with `<redacted>`.
