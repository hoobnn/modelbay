# @modelbay/openai

OpenAI and OpenAI-compatible adapters for [Modelbay](../../README.md). MIT licensed.

| Export                    | Adapter id          | Channel             | Secret                                              |
| ------------------------- | ------------------- | ------------------- | --------------------------------------------------- |
| `openaiAdapter`           | `openai/api`        | `openai`            | `OPENAI_API_KEY`                                    |
| `openaiCompatibleAdapter` | `openai/compatible` | `openai-compatible` | `COMPATIBLE_API_KEY` or `OPENAI_COMPATIBLE_API_KEY` |

The root exports `models`, `channels`, both adapter factories, and
`nativeOperationSchemas`. It uses runtime-neutral APIs; Node helpers live in `/node`.

## Models

Verified against official documentation on **2026-11-05**:

- Text: GPT-6.1 Sol, GPT-6 Astra, GPT-6.1 Terra, GPT-6 Luna.
- Images: GPT-Image-2.6 Sunburst / Flare and GPT-Image-2.5 Sunburst / Flare.
- Existing defaults remain GPT-6.1 Sol for chat and GPT-Image-2.5 Sunburst for images.
  Select `openai:gpt-image-2.6-sunburst` or `openai:gpt-image-2.6-flare` explicitly
  to use the new image models.

Model options, limits, sources, aliases and defaults are declared in `src/models/`.
The [verification notes](../../docs/openai.md) record documentation discrepancies.
Unknown official IDs require `remoteOnly: true`; known models validate their declared options.

## Capabilities and endpoints

| Operation                        | Official endpoint              | Result                                                    |
| -------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `text.chat`                      | `POST /responses` (SSE)        | Text, function calls or validated JSON                    |
| Compatible `text.chat`           | `POST /chat/completions` (SSE) | Text, function calls or JSON                              |
| `image.generate`                 | `POST /images/generations`     | Image bytes; references route to `/images/edits`          |
| `image.edit`                     | `POST /images/edits`           | Mask-guided raster edit; injected mask converter required |
| `native('listModels')`           | `GET /models`                  | Remote model list                                         |
| Official `native('raw-request')` | Responses JSON endpoints       | Full response object, including IDs, items and status     |

Normalized `submit()` completes synchronously; `poll()` rejects because it has no
normalized job lifecycle. Background Responses use the native interface below.

## Text chat

The official adapter uses the [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses).
It defaults to `store: false`, requests `reasoning.encrypted_content` and preserves
same-model encrypted reasoning for function-call continuations. SSE requires a
terminal response event; truncated streams keep `outcome: 'unknown'`.

Options go in `input.extra`:

| Option                                                                        | Wire field                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `reasoning_effort`                                                            | `reasoning.effort`; Sol / Astra: low, medium, high, xhigh, max; Terra / Luna also allow none |
| `reasoning_mode`, `reasoning_summary`, `reasoning_context`                    | `reasoning.mode`, `.summary`, `.context`                                                     |
| `verbosity`                                                                   | `text.verbosity`                                                                             |
| `service_tier`, `parallel_tool_calls`, `safety_identifier`, `metadata`        | Same name                                                                                    |
| `prompt_cache_key`, `prompt_cache_options`                                    | Same name                                                                                    |
| `store`, `previous_response_id`, `conversation`, `truncation`, `instructions` | Same name                                                                                    |
| `reasoning`, `text`, `include`                                                | Native objects; nested reasoning/verbosity take precedence over aliases; include is additive |

Other native top-level fields pass through. The normalized model, input, stream,
function definitions, tool choice, temperature and token budget remain authoritative.
`input.jsonSchema` becomes `text.format` and is also validated locally.
`conversation` and `previous_response_id` are mutually exclusive.
Background generation and cache prewarming require `raw-request` because they can
return a status without generated text. Use it for built-in tools, reasoning
summaries, citations, compaction items, async function definitions, or response IDs
that the normalized output does not represent.

The compatible adapter streams Chat Completions and requires `[DONE]`. Its Base URL
precedence is `ctx.settings.baseURL`, `input.extra.baseURL`, then
`OPENAI_COMPATIBLE_BASE_URL`. `ctx.settings.model` overrides the wire model ID.
`ctx.settings.structured: 'json_schema'` enables strict schemas; the default is
`json_object`. Other non-reserved fields pass through under the compatible protocol;
OpenAI-specific Responses guarantees do not apply to that channel.

## Images

Both image generations and edits forward declared `quality`, `background`,
`output_format`, `output_compression`, `moderation`, `safety_identifier` and `size`
options. Size precedence is explicit `width` / `height`, then `extra.size`, then
`extra.aspectRatio`, then the declaration default. For masked edits use `extra.size`.
JPEG / WebP accept compression; transparent output requires PNG / WebP.

GPT Image 2.6 additionally accepts `complexity`, SVG author settings (`svg.model`
and `svg.reasoning.effort`), and GIF `frame_count` / `frame_duration_ms`.
SVG requires a single output; SVG and GIF require text-only image generation,
without references or a mask. Formats return correct MIME types, including
`image/svg+xml` and `image/gif`. Image and SVG author token usage is reported.
GIF preview and SVG author selection may require account access.

For markup-guided edits, pass source images in `references` and
`extra.markup: { image_url: 'data:image/png;base64,...' }` or `{ file_id: 'file_...' }`.
The host supplies a transparent PNG annotation layer matching the first oriented
source image; Modelbay forwards it unchanged. Markup cannot be combined with a mask.
The normalized image path returns final images and rejects streaming / partial
image options. The local data URL budget remains 14 MiB per raster input, which is
stricter than upstream upload limits.

```ts
const result = await openaiAdapter.submit({
  capability: 'image.generate',
  model: 'openai:gpt-image-2.6-sunburst',
  input: {
    prompt: 'A looping lantern animation',
    extra: { output_format: 'gif', frame_count: 9, frame_duration_ms: 200, complexity: 'medium' },
  },
}, ctx)
```

## Native Responses

`raw-request` supports `POST /responses`, `POST /responses/compact`,
`GET /responses/{id}`, `GET /responses/{id}/input_items`,
`POST /responses/{id}/cancel` and `DELETE /responses/{id}`. Paths are relative to
the official `/v1` base, methods are checked and authorization is injected.
`query` accepts scalar values or arrays. The body uses the native OpenAI schema.
Responses are returned unchanged, including failed / incomplete status resources.
The native interface is JSON-only; WebSocket transport and mid-turn steering are
not implemented.

```ts
const response = await openaiAdapter.native!('raw-request', {
  path: '/responses',
  body: {
    model: 'gpt-6.1-sol',
    input: 'Research this question using official sources.',
    tools: [{ type: 'web_search' }],
    background: true,
    store: false,
  },
}, ctx)
// Persist response.id before polling GET /responses/{id}.
```

## HTTP, errors and secrets

All requests use host-injected `ctx.fetch`. GET can retry transient errors twice;
POST never retries. Ambiguous submissions retain `outcome: 'unknown'`.
Errors use `ProviderError`, with credentials redacted as `[redacted]`.
Authentication, quota, rate limits and moderation failures retain their categories.
Tests use injected responses and never make paid API calls.

## Node-only subpath

`@modelbay/openai/node` (mapped to `dist/node/index.mjs`) holds the Node-only
parts and is never imported by the root entry:

- `assertSameSize()` — validates that an edit mask matches the source image.
- `prepareEditMask(source, mask)` — converts the repo-wide "white = repaint"
  mask into the RGBA alpha mask OpenAI expects: the source is rotated upright
  and re-encoded as PNG, the mask is greyscaled and its brightness is inverted
  into the alpha channel (white → transparent = repaint, black → opaque =
  keep). Sizes must match, otherwise `invalid_input` is thrown. Needs `sharp`
  (Apache-2.0, optional peer dependency the integrator installs).
- `editMask` — the same conversion behind the adapter's injection point
  (`createOpenAIAdapter(models, { editMask })`).
- `prepareImageEditRequest(ctx, opts)` — the whole flow: load the original and
  the mask from `ctx.assets`, convert the mask, and return the `/images/edits`
  request body. The model defaults to the `image.edit` default declared in
  `src/models/`.

**Injecting the mask conversion.** `image.edit` needs the alpha inversion, so
the adapter asks for it instead of importing `sharp` itself:

```ts
import { createOpenAIAdapter, models } from '@modelbay/openai'
import { editMask } from '@modelbay/openai/node'

const adapter = createOpenAIAdapter(models, { editMask })
```

With the conversion injected, the root path still assembles the
`/images/edits` body (`images` / `mask` data URLs) so the root entry and the
subpath share one body builder. Without it, `image.edit` fails with
`invalid_input` naming the subpath and the injection above — it never sends the
raw white-repaint mask, whose meaning is the opposite of what OpenAI expects.
The subpath is listed in `nodeOnly` and not exposed to MCP by default.

## Tests

`test/**/*.test.ts` + `test/fixtures/*.json` replay recorded request/response
pairs with an injected fake `ctx.fetch`; no network access. Coverage covers
request construction, response parsing (success / failed), error mapping
(401 / 429 / 5xx / quota / content_policy), default-model-active and the
synchronous-only `poll()` behaviour.
