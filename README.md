# Modelbay

One SDK for AI model platforms: chat, image, video, speech and music across
Volcengine Ark, Alibaba Bailian, MiniMax, Doubao Speech and OpenAI.

Status: **pre-release**, not yet published to npm (see
[`docs/goals.md`](docs/goals.md)). Design decisions live in
[`docs/decisions/`](docs/decisions/).

One TypeScript implementation serves the SDK, the MCP servers and the CLI.
Model parameters, limits, defaults and lifecycle states are
declared as data; the MCP tool schemas and UI forms are derived from those
declarations, so an upstream change only needs one edit.

## Packages

| Package                   | Role                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `modelbay`                | Aggregation entry: platform registry, `createModelbay()`, `modelbay/node` |
| `@modelbay/core`          | Runtime-agnostic types, validation, model declarations, async job runner  |
| `@modelbay/ark`           | Volcengine Ark adapter (pay-as-you-go + plan channels)                    |
| `@modelbay/bailian`       | Alibaba Bailian adapter                                                   |
| `@modelbay/minimax`       | MiniMax adapter                                                           |
| `@modelbay/doubao-speech` | Doubao Speech adapter                                                     |
| `@modelbay/openai`        | OpenAI (+ OpenAI-compatible channel) adapter                              |
| `@modelbay/mcp`           | MCP server generated from declarations; command `modelbay-mcp <platform>` |
| `@modelbay/cli`           | CLI, command name `modelbay`                                              |
| `@modelbay/shared`        | Internal helpers shared by the platform packages                          |

`packages/*` are ESM-only, MIT licensed, and share one version number
(changesets fixed group).

## Quick start (10 lines)

External TypeScript projects only install `modelbay` and supply a key. Async
polling is handled by the SDK (core's `runJob()`), so there is no polling loop
to write.

```ts
import { createModelbay } from 'modelbay'

const mb = createModelbay({ secrets: { ARK_API_KEY: process.env.ARK_API_KEY ?? '' } })
const { outputs } = await mb.generate({
  capability: 'image.generate',
  input: { prompt: 'a cat wearing a hat' },
})
// outputs[0] is a URL or bytes; the host downloads and persists it
```

Swap the `capability` to `video.generate` or `audio.speech` (with
`input: { text: ... }`) for video and dubbing. When `model` is omitted, the
default is chosen from `active` declarations only, by
`ModelRegistry.defaultFor()` — consumers never hardcode a default. Results are
URLs or bytes; keys are supplied by the host and are never stored or printed by
the SDK. `createModelbay()` also reads keys from `process.env` when `secrets`
is omitted.

See [`packages/modelbay/README.md`](packages/modelbay/README.md) for the full
API and key names.

## CLI

```sh
modelbay models [platform]   # list models and their lifecycle status
modelbay capabilities        # list capabilities
modelbay doctor              # check key configuration (never prints keys)
modelbay generate --capability image.generate --prompt "a cat" --model ark:doubao-seedream
```

## Development

`pnpm verify` runs the full check: dedupe, lint, typecheck, tests with
per-package coverage, an offline check of every declaration's official source,
build, and package/license/core-runtime checks. Adding a model, platform,
capability or MCP tool is described in [`docs/extending.md`](docs/extending.md);
conventions are in [`docs/engineering.md`](docs/engineering.md).

Releases are manual and maintainer-approved. A daily job fetches each platform's
official docs, reconciles model lists and deprecation notices against the
declarations in both directions, tracks gaps in an issue, and opens a draft PR
for lifecycle patches ([`docs/upstream.md`](docs/upstream.md), in Chinese).

MIT © ikuyu
