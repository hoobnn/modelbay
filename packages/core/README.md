# @modelbay/core

> Internal workspace package, not published to npm. Its whole API is re-exported from `modelbay`.

Runtime-agnostic foundation of [Modelbay](../../README.md): capability types,
model parameter validation, media requirements, error normalization, model
declarations, the async job runner, and the `PlatformDescriptor` type that every
platform package exports (`definePlatform()`, `readSecrets()`, `missingSecrets()`).

It only uses APIs available in every runtime (`fetch`, `Uint8Array`,
`ReadableStream`, `AbortSignal`, `crypto.subtle`). Node-only capabilities are
exported from optional subpaths of the platform adapters, never from this
package.

```ts
import { modelParamsProblem, ProviderError, type ModelSpec } from 'modelbay'
```

`zod` is a peer dependency — install it once in the host application so that
core schemas and host schemas share a single instance.

Everything is exported from the package root; there are no subpath exports.

## License

MIT
