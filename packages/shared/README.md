# @modelbay/shared

Runtime-agnostic building blocks shared by the [Modelbay](../../README.md)
platform adapters. Every platform package imports the same implementation from
here instead of copying it; types come from `@modelbay/core`.

| Area             | Exports                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| HTTP transport   | `send`, `readJson`, `readText`, `withRetry`, `retryableFor`, `transportError`, `redact`                       |
| Chat             | `chatCompletion`, `chatMessages`, `requireSseDone`, `imageDataUrl` (OpenAI-compatible, via the Vercel AI SDK) |
| Model lists      | `openAiModelList`, `minimaxModelList`                                                                         |
| Media references | `videoReferences`, `downloadVoicePreview`                                                                     |
| Size math        | `ratioOf`, `sizeByArea`, `sizeByLongEdge`, `tierEdge`                                                         |

This package is an internal dependency of the adapters. Application code should
depend on `modelbay` or a specific `@modelbay/<platform>` package; the API here
may change in any `0.x` release without notice.

Like `@modelbay/core`, it only uses APIs available in every runtime and has a
single root export.

## License

MIT
