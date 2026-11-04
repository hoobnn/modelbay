# @modelbay/openai

OpenAI and OpenAI-compatible adapters for [Modelbay](../../README.md). MIT licensed.

| Export                    | Adapter id          | Channel             | Base URL                    | Secret                      |
| ------------------------- | ------------------- | ------------------- | --------------------------- | --------------------------- |
| `openaiAdapter`           | `openai/api`        | `openai`            | `https://api.openai.com/v1` | `OPENAI_API_KEY`            |
| `openaiCompatibleAdapter` | `openai/compatible` | `openai-compatible` | host-supplied               | `OPENAI_COMPATIBLE_API_KEY` |

`models` (re-exported from `src/models/index`'s `all`) and `channels`
(`['openai', 'openai-compatible']`) are exported from the root entry.

The compatible channel has no `settings` slot in `AdapterContext`, so its
non-secret Base URL is conveyed through the same injected `name → value`
resolver used for keys:

- `ctx.secret('OPENAI_COMPATIBLE_BASE_URL')` — channel Base URL (must be HTTPS,
  or `http://localhost`; validated by `compatibleBaseURL()`).
- `input.extra.baseURL` — per-request override, takes precedence. It is a
  reserved key and is never forwarded to the upstream body.
- `ctx.secret('OPENAI_COMPATIBLE_API_KEY')` — Bearer token.

Remote-only model ids pass through; `渠道:渠道内ID` references are stripped to
the channel-local id before the request is built.

## Capabilities and endpoints

| Capability             | Endpoint                   | Result                                     |
| ---------------------- | -------------------------- | ------------------------------------------ |
| `text.chat`            | `POST /chat/completions`   | synchronous text / tool calls / JSON       |
| `image.generate`       | `POST /images/generations` | `b64_json` file outputs                    |
| `image.edit`           | `POST /images/edits`       | `b64_json` file outputs (see Node subpath) |
| `native('listModels')` | `GET /models`              | OpenAI-compatible model list               |

Both channels are **synchronous**: there is no async task lifecycle, so `poll()`
rejects with a clear `ProviderError('invalid_input')` instead of fabricating a
task. Asynchronous submit/poll/cancel is implemented by `@modelbay/ark`.

## Text chat: platform field passthrough

Chat uses the OpenAI-compatible `/chat/completions` endpoint (non-streaming) for
**both** adapters, as required by M3. The adapter controls only `model`,
`messages`, `stream`, `tools`, `tool_choice`, `response_format`, `temperature`,
`max_tokens`, `n` and `baseURL` (the reserved set). **Every other key in
`input.extra` is forwarded verbatim** into the JSON body. Verified fields:

| Field                                            | How it travels                                       | Notes                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `previous_response_id`                           | `input.extra.previous_response_id` → body            | forwarded unchanged. It is an OpenAI Responses-API field; a Chat Completions endpoint may ignore it — Modelbay does not strip or reject it |
| `reasoning_effort`                               | `input.extra.reasoning_effort` → body                | forwarded unchanged (reasoning models)                                                                                                     |
| `thinking`                                       | `input.extra.thinking` → body                        | forwarded unchanged                                                                                                                        |
| 联网搜索 / `web_search`                          | `input.extra.web_search` → body                      | forwarded unchanged; honouring it is up to the endpoint                                                                                    |
| `top_p`, `frequency_penalty`, `presence_penalty` | `input.extra.*`                                      | forwarded unchanged                                                                                                                        |
| `continuation` / `thinking` continuation         | `ChatMessage.continuation` on an `assistant` message | converted back to `reasoning_content` / `encrypted_content` on the wire message; received values become `tool_calls.continuation`          |

Official OpenAI chat uses `response_format: { type: 'json_schema', ... }` when
`input.jsonSchema` is set; the compatible channel downgrades to `json_object`
and parses the reply into a `{ type: 'json' }` output, because generic channels
may not support strict schemas. `401` is mapped to `auth`, `429` to
`rate_limit`, `5xx` to `unavailable`, `insufficient_quota` to `quota` and
`content_policy_violation` to `content_policy`.

## HTTP, errors and secrets

- All requests go through `ctx.fetch` (host-injected); the global `fetch` is
  never called. Keys are read with `ctx.secret(name)` and never persisted or
  logged.
- Retryable errors (`rate_limit`, `unavailable`, `timeout`) are retried for GET
  only (up to 2 attempts). POST submissions are never retried and are marked
  `outcome: 'unknown'` on gateway timeouts / 5xx.
- Every failure throws `ProviderError` with a `ProviderErrorCode`; the upstream
  HTTP status, code and (redacted) message are kept in `cause`.
- `Authorization`, keys and account ids in error text are replaced with
  `<redacted>`; recorded fixtures in `test/fixtures/` use `<redacted>` too.

## Node-only subpath

`@modelbay/openai/node` (mapped to `dist/node/index.mjs`) holds the Node-only
parts and is never imported by the root entry:

- `assertSameSize()` — validates that an edit mask matches the source image.
- `prepareEditMask()` — **TODO (M3)**: the white=repaint → RGBA alpha mask
  inversion requires `sharp` (a Node-only dependency for the integrator to
  install). It currently throws a clear `ProviderError('unavailable')`.

The root `image.edit` path constructs `/images/edits` with `images` / `mask`
data URLs from `ctx.assets`; the proper alpha inversion should be applied via
this subpath before submission. It is listed in `nodeOnly` and not exposed to
MCP by default.

## Tests

`test/**/*.test.ts` + `test/fixtures/*.json` replay recorded request/response
pairs with an injected fake `ctx.fetch`; no network access. Coverage covers
request construction, response parsing (success / failed), error mapping
(401 / 429 / 5xx / quota / content_policy), default-model-active and the
synchronous-only `poll()` behaviour.
