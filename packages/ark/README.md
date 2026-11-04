# @modelbay/ark

Volcengine Ark adapter for [Modelbay](../../README.md). MIT licensed.

This package exposes **two** `PlatformAdapter`s, matching the two Ark data planes
that plein used to maintain separately:

| Export           | Adapter id      | Channel    | Base URL                                        | Secret                   |
| ---------------- | --------------- | ---------- | ----------------------------------------------- | ------------------------ |
| `arkAdapter`     | `volc/ark`      | `ark`      | `https://ark.cn-beijing.volces.com/api/v3`      | `ARK_API_KEY`            |
| `arkPlanAdapter` | `volc/ark-plan` | `ark-plan` | `https://ark.cn-beijing.volces.com/api/plan/v3` | `ARK_AGENT_PLAN_API_KEY` |

`models` (re-exported from `src/models/index`'s `all`) and `channels`
(`['ark', 'ark-plan']`) are exported from the root entry. Plan image/video model
names are translated at request time by `wireModel()` (e.g.
`doubao-seedream-5-0-pro-260628` → `doubao-seedream-5.0-pro`); chat, image and
video ids otherwise pass through unchanged, including custom Endpoint IDs.

## Capabilities and endpoints

| Capability             | Endpoint                                        | Result                                |
| ---------------------- | ----------------------------------------------- | ------------------------------------- |
| `text.chat`            | `POST /chat/completions`                        | synchronous text / tool calls / JSON  |
| `image.generate`       | `POST /images/generations`                      | `b64_json` or URL file outputs        |
| `image.process`        | `POST /images/generations`                      | Seedream layer decomposition (cutout) |
| `video.generate`       | `POST /contents/generations/tasks`              | asynchronous task (`remoteId`)        |
| `poll` / `cancel`      | `GET`/`DELETE /contents/generations/tasks/{id}` | task lifecycle                        |
| `native('listModels')` | `GET /models`                                   | OpenAI-compatible model list          |

Video tasks are polled by the host via `runJob()` (`@modelbay/core`); the adapter
returns `{ state: 'pending', remoteId, pollAfterMs: 5000 }` and parses
`queued` / `running` / `succeeded` / `failed` / `cancelled` / `expired`.

`audio.speech` on the plan channel delegates to
`@modelbay/doubao-speech` — the only cross-adapter dependency allowed by the
contract. `src/speech.ts` imports `synthesizeSpeech` statically and calls
`synthesizeSpeech('seed-tts-2.0', input, ctx, true)`; `plan = true` selects the
`/api/v3/plan/tts/unidirectional` endpoint and restricts the channel to preset
2.0 voices. `speechSettings` / `TTS_VOICES` are consumed by the declarations.
Upstream failures propagate as the original `ProviderError` (no re-wrapping);
no key or signature is logged. Tests replay a recorded chunked audio stream and
assert both the plan endpoint and the error path, so the reuse is verified
rather than falling back to a stub.

## Text chat: platform field passthrough

Chat uses the OpenAI-compatible `/chat/completions` endpoint (non-streaming).
The adapter controls only `model`, `messages`, `stream`, `tools`, `tool_choice`,
`response_format`, `temperature`, `max_tokens`, `n` and `baseURL` (the reserved
set). **Every other key in `input.extra` is forwarded verbatim** into the JSON
body — nothing is stripped, renamed or validated. Verified fields:

| Field                                            | How it travels                                       | Notes                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thinking`                                       | `input.extra.thinking` → body `thinking`             | Ark reasoning switch, e.g. `{ "type": "enabled" }`                                                                                                                     |
| 联网搜索 / `web_search`                          | `input.extra.web_search` → body `web_search`         | forward unchanged; honouring it is up to the endpoint                                                                                                                  |
| `previous_response_id`                           | `input.extra.previous_response_id` → body            | forwarded unchanged; it is an OpenAI Responses-API field, so a Chat Completions endpoint may ignore it                                                                 |
| `top_p`, `frequency_penalty`, `presence_penalty` | `input.extra.*`                                      | forwarded unchanged                                                                                                                                                    |
| `continuation` / `thinking` continuation         | `ChatMessage.continuation` on an `assistant` message | converted back to `reasoning_content` and `encrypted_content` on the wire message; received `reasoning_content` / `encrypted_content` become `tool_calls.continuation` |

`ChatMessage.continuation` is deliberately kept out of the assistant's visible
text. Structured output (`input.jsonSchema`) uses
`response_format: { type: 'json_schema', ... }` (or `json_object` for compatible
channels) and parses the reply into a `{ type: 'json' }` output.

## HTTP, errors and secrets

- All requests go through `ctx.fetch` (host-injected); the global `fetch` is
  never called. Keys are read with `ctx.secret(name)` and never persisted.
- Transport failures are classified as `cancelled` / `timeout` / `unavailable`;
  retryable errors (`rate_limit`, `unavailable`, `timeout`) are retried for GET
  only (up to 2 attempts). POST submissions are never retried and are marked
  `outcome: 'unknown'` on gateway timeouts / 5xx, because the platform may
  already have accepted and billed them.
- Every failure throws `ProviderError` with a `ProviderErrorCode`; the upstream
  HTTP status, code and (redacted) message are kept in `cause`.
- `Authorization`, keys, account ids and signatures in error text are replaced
  with `<redacted>`; recorded fixtures in `test/fixtures/` use `<redacted>` too.

## Node-only subpath

`@modelbay/ark/tos` (mapped to `dist/node/index.mjs`) contains the parts that
require Node and must not be loaded from the root entry:

- `s3Target()` / `referenceStorageHost()` / `presignS3()` / `objectKey()` — S3
  SigV4 presigning for reference-video uploads (`node:crypto`).
- `planDirectoryHeaders()` / `listPlanModels()` — the AK/SK-signed Agent Plan
  model-directory request (`node:crypto`).
- `asrFrame()` / `asrPacket()` — the gzip frame codec for plan ASR (`node:zlib`).

**TODO (M3):** `tosUploader()` still needs `@volcengine/tos-sdk` (a Node-only
dependency for the integrator to install) and `transcribePlan()` needs a
`ctx.socket` WebSocket hook. Both currently throw descriptive
`ProviderError('unavailable')` stubs. They are listed in `nodeOnly` and are not
exposed to MCP by default. `native('listModels')` on the plan channel likewise
directs callers to `listPlanModels` in this subpath.

## Tests

`test/**/*.test.ts` + `test/fixtures/*.json` replay recorded request/response
pairs with an injected fake `ctx.fetch`; no network access. Coverage covers
request construction, response parsing (success / pending / failed), error
mapping (401 / 429 / 5xx), async polling and the default-model-active rule.
