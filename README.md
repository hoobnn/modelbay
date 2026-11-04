# Modelbay

One SDK for AI model platforms: chat, image, video, speech and music across
Volcengine Ark, Alibaba Bailian, MiniMax, Doubao Speech and OpenAI.

Status: **in development**. Work is organised into milestones M1–M5 (see
[`docs/goals.md`](docs/goals.md)); the completion status of each milestone is
reported by the integrator's final report. Design decisions live in
[`docs/decisions/`](docs/decisions/).

Modelbay replaces two duplicated platform integrations — `hoobnn-mcps` (Python)
and `plein/packages/providers` (TypeScript) — with a single TypeScript
implementation. Model parameters, limits, defaults and lifecycle states are
declared as data; the MCP tool schemas and UI forms are derived from those
declarations, so an upstream change only needs one edit.

## Packages

| Package                   | Role                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `modelbay`                | Aggregation entry: re-exports core + all adapters, `createModelbay()`    |
| `@modelbay/core`          | Runtime-agnostic types, validation, model declarations, async job runner |
| `@modelbay/ark`           | Volcengine Ark adapter (pay-as-you-go + plan channels)                   |
| `@modelbay/bailian`       | Alibaba Bailian adapter                                                  |
| `@modelbay/minimax`       | MiniMax adapter                                                          |
| `@modelbay/doubao-speech` | Doubao Speech adapter                                                    |
| `@modelbay/openai`        | OpenAI (+ OpenAI-compatible channel) adapter                             |
| `@modelbay/mcp`           | MCP tool generator; commands `modelbay-<platform>-mcp`                   |
| `@modelbay/cli`           | CLI, command name `modelbay`                                             |

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

`pnpm verify` runs the full check: dedupe, lint, typecheck, tests with coverage,
declaration checks, build, and package/license/core-runtime checks. Releases are
manual and maintainer-approved; see [`docs/migration.md`](docs/migration.md)
and [`.github/workflows/release.yml`](.github/workflows/release.yml). Upstream
documentation changes are audited by
[`scripts/upstream-docs.mjs`](scripts/upstream-docs.mjs) on a daily schedule.

MIT © ikuyu
