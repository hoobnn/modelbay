# Modelbay

[简体中文](README.zh-CN.md) · **English**

[![npm](https://img.shields.io/npm/v/modelbay)](https://www.npmjs.com/package/modelbay)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Modelbay is an open-source (MIT) TypeScript SDK, MCP server and CLI that give you one interface to Chinese and global AI model platforms: Volcengine Ark (Doubao, Seedream, Seedance), Alibaba Cloud Bailian / DashScope (Qwen, Wan), MiniMax, Doubao Speech and OpenAI. It covers chat, image, video, speech and music generation, and handles async job polling for you.

Install the SDK with `npm i modelbay zod`, or add an MCP server to Claude Code, Codex, Cursor or Claude Desktop with `npx -y @modelbay/mcp ark`. Packages are on npm as [`modelbay`](https://www.npmjs.com/package/modelbay), `@modelbay/mcp` and `@modelbay/cli`. Design decisions live in [`docs/decisions/`](docs/decisions/).

One TypeScript implementation serves the SDK, the MCP servers and the CLI.
Model parameters, limits, defaults and lifecycle states are
declared as data; the MCP tool schemas and UI forms are derived from those
declarations, so an upstream change only needs one edit.

## Packages

Three packages are published to npm:

| Package         | Role                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `modelbay`      | The SDK: core API, `createModelbay()`, platform registry, `modelbay/node` |
| `@modelbay/mcp` | MCP server generated from declarations; command `modelbay-mcp <platform>` |
| `@modelbay/cli` | CLI, command name `modelbay`                                              |

Platform-specific exports live on subpaths of `modelbay`: `modelbay/ark`,
`modelbay/bailian`, `modelbay/minimax`, `modelbay/doubao-speech`,
`modelbay/openai`, plus `modelbay/<platform>/node` for Node-only helpers.

Inside the repo, `@modelbay/core`, `@modelbay/shared` and the five platform
packages stay separate private workspace packages that keep the layering honest;
`modelbay` bundles them at build time. All packages are ESM-only, MIT licensed,
and share one version number (changesets fixed group).

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

## FAQ

**What is Modelbay?** A TypeScript SDK, MCP server and CLI for Volcengine Ark, Alibaba Bailian, MiniMax, Doubao Speech and OpenAI. One implementation serves all three entry points, driven by a single set of model declarations.

**How do I use it in Claude Code, Codex, Cursor or Claude Desktop?** Add an MCP server that runs `npx -y @modelbay/mcp <platform>` (`ark`, `minimax`, `bailian`, `doubao-speech` or `openai`) and pass the platform key through the server's environment, for example `ARK_API_KEY`. Each platform is a separate server. See [`packages/mcp/README.md`](packages/mcp/README.md).

**Which platforms and capabilities are supported?** Ark, Bailian, MiniMax, Doubao Speech and OpenAI; chat, image generation and editing, video generation, speech, music, voice cloning and design, and transcription, depending on the platform. Run `modelbay models` or `modelbay capabilities` for the current list, or see the [goals](docs/goals.md).

**Is it free? Which license?** Free and open source under the MIT license. Model usage is billed by each platform on your own account.

**Where do API keys go?** The host supplies them through `createModelbay({ secrets })` or environment variables such as `ARK_API_KEY`, `BAILIAN_API_KEY` (alias `DASHSCOPE_API_KEY`), `MINIMAX_API_KEY`, `DOUBAO_API_KEY` and `OPENAI_API_KEY`. The SDK never stores or prints them.

**Does it run outside Node?** The root `modelbay` entry only uses APIs available in Node, Bun, Deno and browsers; Node-only helpers are under the `modelbay/node` subpath.

**When should I use something else?** If you only call one platform and need every vendor-specific feature, that vendor's official SDK is the more direct choice. Modelbay is for working across several platforms, or exposing them as MCP tools.

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
