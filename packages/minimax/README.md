# @modelbay/minimax

> Internal workspace package, not published to npm. Install `modelbay` and import these exports from `modelbay/minimax`.

MiniMax adapter for [Modelbay](../../README.md). MIT licensed.

```ts
import { minimaxAdapter } from 'modelbay/minimax'
import { createAdapterContext } from 'modelbay'

const ctx = createAdapterContext({ secrets: { MINIMAX_API_KEY: '...' } })
const result = await minimaxAdapter.submit(
  { capability: 'text.chat', model: 'MiniMax-M3', input: { messages: [{ role: 'user', content: 'Hi' }] } },
  ctx,
)
```

Only `ctx.fetch` and `ctx.secret` are used. The key comes from `MINIMAX_API_KEY`;
`MINIMAX_REGION=global` or `MINIMAX_BASE_URL` selects `api.minimax.io` instead of the
default `api.minimax.cn`. No key is stored and no `console.*` is emitted.

## Capabilities

`submit` handles `text.chat`, `image.generate`, `video.generate` (async), `audio.speech`
(hex audio decoded to bytes without `Buffer`), and `audio.music`. `poll` / `cancel` handle
H3 V2 task IDs. Platform-specific fields are passed through unchanged: `input.extra` is
merged verbatim into each request body (confirmed against `/v1/chat/completions`,
`/v1/image_generation`, `/v2/video_generation` and `/v1/t2a_v2`).

## Native operations

Declared in `MINIMAX_NATIVE_OPERATIONS`; each op's input JSON Schema is declared by the
adapter in `nativeOperationSchemas` (for the MCP generator). Supported operations:

- `context-ir` — `POST /v2/h3_context_ir` (H3 structured prompt enhancement, async)
- `video-2k-rerender` — `POST /v2/video_regeneration` (768P -> 2K regeneration)

Also implemented:

- `voice-clone` — multipart upload + `POST /v1/voice_clone`
- `voice-design` — `POST /v1/voice_design`
- `upload-file` — `POST /v1/files/upload` (FormData via `ctx.assets`)
- `list-video-tasks` — `GET /v2/query/video_generation` (paginated)
- `raw-request` — arbitrary `path` / `method` / `body` / `query` fallback

MCP tools use the same names as the other platforms (`generate_image`, `text_to_speech`,
`clone_voice`, `design_voice`); `create_h3_context_ir_task` and `regenerate_video` map to the
native ops above.

## Errors and redaction

Business errors (`base_resp.status_code`, `error.type`) are normalized to
`ProviderErrorCode`; the raw code/message is preserved in `error.cause` with credentials
scrubbed. POST submissions are never retryable, gateway failures are flagged
`outcome: 'unknown'`, and query GETs may be retried on rate-limit / unavailable / timeout.
Recorded fixtures under `test/fixtures/` have `Authorization` replaced with `<redacted>`.
