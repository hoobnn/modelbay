# @modelbay/core

Runtime-agnostic foundation of [Modelbay](../../README.md): capability types,
model parameter validation, media requirements, error normalization and model
declarations.

It only uses APIs available in every runtime (`fetch`, `Uint8Array`,
`ReadableStream`, `AbortSignal`, `crypto.subtle`). Node-only capabilities are
exported from optional subpaths of the platform adapters, never from this
package.

```ts
import { modelParamsProblem, ProviderError, type ModelSpec } from '@modelbay/core'
```

`zod` is a peer dependency — install it once in the host application so that
core schemas and host schemas share a single instance.

Subpath exports mirror the modules that were moved out of `@plein/plugin-sdk`:
`@modelbay/core/provider`, `/model-params`, `/media-requirements`,
`/image-input`, `/video-input`, `/ids`, `/ports`, `/media` and
`/reference-tokens`.

## License

MIT
