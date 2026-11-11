# modelbay

The single install point for the [Modelbay](https://github.com/hoobnn/modelbay#readme) SDK. It bundles
the runtime-agnostic core API and the five platform adapters, holds the platform
registry, and adds `createModelbay()` which wires everything together.

MIT licensed.

## Install

```sh
pnpm add modelbay
```

`zod` is a peer dependency; install it alongside if your project does not
already have it.

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

Use `capability: 'video.generate'` or `capability: 'audio.speech'` (with
`input: { text: ... }`) for video and dubbing. When `model` is omitted, the
default is chosen from `active` declarations only, by
`ModelRegistry.defaultFor()` — consumers never hardcode a default.

`createModelbay()` also reads the keys below from `process.env` when `secrets`
is omitted, so `createModelbay()` with no arguments is enough once the
environment is set up.

## API

| Export                                                | Description                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `createModelbay(options)`                             | Build a `Modelbay` with a registered model registry           |
| `defaultAdapters(platforms?)`                         | Runtime-agnostic adapters of every registered platform        |
| `PLATFORMS`, `findPlatform(key)`                      | Platform registry (`PlatformDescriptor` per platform)         |
| `Modelbay.generate(request)`                          | Submit + poll; returns `JobOutcome` (URLs or bytes)           |
| `Modelbay.registry`                                   | `ModelRegistry` (`all`, `resolve`, `defaultFor`, `list`, ...) |
| `Modelbay.capabilities()`                             | Deduplicated normalized capabilities                          |
| `Modelbay.doctor()`                                   | Key configuration report with missing names; never values     |
| `ark`, `bailian`, `minimax`, `doubaoSpeech`, `openai` | Namespace re-exports of the platform packages                 |

Everything exported by `@modelbay/core` is re-exported here as well, so a
consumer needs only the single `modelbay` dependency.

## Keys

Keys are supplied by the host and are never stored, logged or printed by the
SDK. The environment variable names come from each platform's descriptor
(`PLATFORMS[i].secrets`); any one group is enough:

| Platform        | Variables                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| Volcengine Ark  | `ARK_API_KEY`, or `ARK_AGENT_PLAN_API_KEY`                                     |
| Alibaba Bailian | `BAILIAN_API_KEY` (alias `DASHSCOPE_API_KEY`), or `BAILIAN_TOKEN_PLAN_API_KEY` |
| MiniMax         | `MINIMAX_API_KEY`                                                              |
| Doubao Speech   | `DOUBAO_API_KEY`, or `DOUBAO_APP_ID` + `DOUBAO_ACCESS_TOKEN`                   |
| OpenAI          | `OPENAI_API_KEY`, or `OPENAI_COMPATIBLE_API_KEY`                               |

## Platform-specific exports

Each platform's own exports (adapter factories, model declarations, options)
are on a subpath; Node-only helpers are on `<platform>/node`:

```ts
import { createArkAdapter, models } from 'modelbay/ark'
import { uploadReferenceVideo } from 'modelbay/ark/node'
```

Subpaths: `modelbay/ark`, `modelbay/bailian`, `modelbay/minimax`,
`modelbay/doubao-speech`, `modelbay/openai`, and `/node` for `ark`, `bailian`,
`doubao-speech`, `openai`. The root entry also exposes each platform as a
namespace (`ark`, `bailian`, `minimax`, `doubaoSpeech`, `openai`).

## Node-only capabilities

The root entry is runtime-agnostic. On Node, `modelbay/node` loads each
platform's `@modelbay/<platform>/node` extension (object-storage upload, `sharp`
mask processing, WebSocket ASR, ...) and injects it:

```ts
import { createModelbay } from 'modelbay'
import { nodeAdapters } from 'modelbay/node'

const mb = createModelbay({ adapters: await nodeAdapters() })
```

## Design notes

- Default models are selected only through `ModelRegistry.defaultFor()` /
  `selectDefaultModel()` and only from `active` declarations.
- Results are URLs or bytes. Downloading and persistence belong to the host.
- Library code contains no `console.*`; progress and usage are reported through
  `ModelbayHooks`.
- `fetch` can be injected through `createModelbay({ fetch })`, which makes the
  whole path testable with recorded fixtures and no network.
