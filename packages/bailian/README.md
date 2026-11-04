# @modelbay/bailian

Alibaba Bailian / DashScope adapter for [Modelbay](../../README.md). MIT licensed.

```ts
import { bailianAdapter } from '@modelbay/bailian'
import { createAdapterContext } from '@modelbay/core'

const ctx = createAdapterContext({ secrets: { BAILIAN_API_KEY: '...' } })
const result = await bailianAdapter.submit(
  { capability: 'text.chat', model: 'qwen3.8-max', input: { messages: [{ role: 'user', content: 'Hi' }] } },
  ctx,
)
```

Only `ctx.fetch` and `ctx.secret` are used. The canonical API key name is
`BAILIAN_API_KEY` (injected by the `modelbay` entry / CLI); `DASHSCOPE_API_KEY` is
accepted as an alias so hosts using the upstream name keep working.
`BAILIAN_BASE_URL` / `DASHSCOPE_BASE_URL` (default `https://dashscope.aliyuncs.com`) and
`BAILIAN_POLL_INTERVAL_MS` / `DASHSCOPE_POLL_INTERVAL_MS` (default `10000`) may be
supplied through `ctx.secret` as host-managed configuration. No key is stored, and
no `console.*` is emitted.

## Capabilities

`submit` handles `text.chat`, `image.generate`, `audio.speech`, `video.generate` (async),
and `poll` / `cancel` handle DashScope task IDs. Platform-specific fields are passed
through unchanged: `input.extra` is merged verbatim into the request body for chat and
image/video `parameters` (confirmed against the OpenAI-compatible chat/completions and
multimodal-generation contracts). `image.edit` / `image.process` are Node-only — see below.

## Python MCP capabilities ported to TypeScript (M3)

All four are plain HTTP through `ctx.fetch`; there is no WebSocket. They are exported as
functions and are also callable as native operations:

| Capability                                     | Module     | Endpoint                                                    | Native op                                   |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------- | ------------------------------------------- |
| Qwen-Audio-TTS / CosyVoice (SpeechSynthesizer) | `tts.ts`   | `POST /api/v1/services/audio/tts/SpeechSynthesizer`         | `qwen-audio-tts`                            |
| ASR (`qwen3-asr-flash`)                        | `asr.ts`   | `POST /compatible-mode/v1/chat/completions` (non-streaming) | `asr`                                       |
| Voice cloning (`voice-enrollment`)             | `voice.ts` | `POST /api/v1/services/audio/tts/customization`             | `voice-clone`                               |
| Voice design / list / query                    | `voice.ts` | same customization endpoint                                 | `voice-design`, `voice-list`, `voice-query` |

`synthesizeQwenAudioTts` handles a single chunk (<= 250 characters); `splitText` is exported
for hosts that need chunking. The SDK never auto-retries an ambiguous submission.

## Native operations

Declared in `BAILIAN_NATIVE_OPERATIONS`; each op's input JSON Schema is declared by the
adapter in `nativeOperationSchemas` (for the MCP generator):

- `rerank` — `POST /api/v1/services/rerank/text-rerank/text-rerank`
- `text-embed` — text (`/compatible-mode/v1/embeddings`) or multimodal (`/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding`)
- `qwen-audio-tts`, `asr`, `voice-clone`, `voice-design`, `voice-list`, `voice-query`
- `digital-human-lipsync` — `wan2.2-s2v` portrait animation (async task)
- `raw-request` — arbitrary `path` / `method` / `body` fallback

## Node-only subpath

`@modelbay/bailian/image-edit` exports `buildImageEditRequest()` and marks the
`sharp`-based mask normalization plus the OSS multipart upload as a **TODO**. The root
entry deliberately excludes it; `submit` for `image.edit` / `image.process` returns a
clear `invalid_input` pointing at this subpath.

## Errors and redaction

All failures are `ProviderError` with a `ProviderErrorCode`; the raw upstream code/message
is kept in `error.cause` (credentials scrubbed). POST submissions are never marked
retryable and gateway failures are flagged `outcome: 'unknown'`. Recorded fixtures under
`test/fixtures/` have `Authorization` and credentials replaced with `<redacted>`.
