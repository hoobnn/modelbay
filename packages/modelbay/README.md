# modelbay

The single install point for the [Modelbay](../../README.md) SDK. It re-exports
the runtime-agnostic `@modelbay/core` API and the five platform adapter packages,
and adds `createModelbay()` which wires everything together.

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
| `defaultAdapters()`                                   | The five default platform adapters                            |
| `MODELBAY_SECRET_ENV_VARS`                            | Canonical key names per platform                              |
| `Modelbay.generate(request)`                          | Submit + poll; returns `JobOutcome` (URLs or bytes)           |
| `Modelbay.registry`                                   | `ModelRegistry` (`all`, `resolve`, `defaultFor`, `list`, ...) |
| `Modelbay.capabilities()`                             | Deduplicated normalized capabilities                          |
| `Modelbay.doctor()`                                   | Key configuration report; never contains key values           |
| `ark`, `bailian`, `minimax`, `doubaoSpeech`, `openai` | Namespace re-exports of the platform packages                 |

Everything exported by `@modelbay/core` is re-exported here as well, so a
consumer needs only the single `modelbay` dependency.

## Keys

Keys are supplied by the host and are never stored, logged or printed by the
SDK. The canonical environment variable names are:

| Platform        | Variables                                        |
| --------------- | ------------------------------------------------ |
| Volcengine Ark  | `ARK_API_KEY`                                    |
| Alibaba Bailian | `DASHSCOPE_API_KEY`                              |
| MiniMax         | `MINIMAX_API_KEY`                                |
| Doubao Speech   | `VOLC_SPEECH_APP_ID`, `VOLC_SPEECH_ACCESS_TOKEN` |
| OpenAI          | `OPENAI_API_KEY`                                 |

## Design notes

- Default models are selected only through `ModelRegistry.defaultFor()` /
  `selectDefaultModel()` and only from `active` declarations.
- Results are URLs or bytes. Downloading and persistence belong to the host.
- Library code contains no `console.*`; progress and usage are reported through
  `ModelbayHooks`.
- `fetch` can be injected through `createModelbay({ fetch })`, which makes the
  whole path testable with recorded fixtures and no network.
