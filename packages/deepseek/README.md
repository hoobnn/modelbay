# DeepSeek

Internal runtime-agnostic platform package, bundled into `modelbay/deepseek`.

Configure `DEEPSEEK_API_KEY`; optionally set `DEEPSEEK_BASE_URL` for a compatible
service. SDK, MCP (`modelbay-mcp deepseek`) and CLI (`modelbay models deepseek`)
use the same platform descriptor and declarations.

```ts
import { createModelbay } from 'modelbay'

const bay = createModelbay({ secrets: { DEEPSEEK_API_KEY: '...' } })
const result = await bay.generate({
  capability: 'text.chat',
  model: 'deepseek:deepseek-flash',
  input: {
    messages: [{ role: 'user', content: '介绍一下杭州' }],
    extra: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  },
})
```

`deepseek-flash` (DeepSeek V4.1 Flash 1017) supports images; `deepseek-v4-pro`
(V4 Pro 0813) accepts text. Both support tools, thinking and structured output.
Old Flash IDs are compatibility routes to Flash, and are not separate models.
Limits and options are recorded in `src/models/` with official sources and dates.

Chat Completions is the default normalized chat protocol. Set `extra.api` to
`responses` for Responses; `web_search`, `read_url`, `safety_check` and `title`
also select Responses. Tool calls return continuation data for the next assistant
message. JSON metadata preserves web calls, citations, titles and server tool usage.
Use the native Responses request API for complete web-tool conversation history
and file content blocks; normalized `ChatMessage` only carries text and images.
The native Messages, Chat Completions and FIM APIs accept vendor request bodies.

Standalone search, URL fetch, OCR, files, balance, model discovery and speech APIs
are exposed as SDK functions and named MCP tools. ASR and TTS have no official
model ID, so they are services rather than invented model declarations.

Official references (checked 2026-11-13):

- [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [API model metadata](https://api-docs.deepseek.com/api/list-models/)
- [Application API release](https://api-docs.deepseek.com/updates/)
- [Responses](https://api-docs.deepseek.com/api/create-response/)
- [TTS](https://api-docs.deepseek.com/api/tts/) and [ASR](https://api-docs.deepseek.com/api/asr/)

## Standalone services

These services do not require a model ID. Pass `createAdapterContext()` with
`DEEPSEEK_API_KEY` and an optional injected fetch implementation.

```ts
import { createAdapterContext } from 'modelbay'
import { search, uploadFile, recognizeDocument, transcribeSpeech, synthesizeSpeech,
  protocolRequest, protocolResponse } from 'modelbay/deepseek'

const ctx = createAdapterContext({ secrets: { DEEPSEEK_API_KEY: '...' } })
const results = await search(ctx, { query: 'DeepSeek', count: 5 })
const uploaded = await uploadFile(ctx, {
  file: new Uint8Array([/* PDF bytes */]), filename: 'report.pdf',
  purpose: 'rich_layout_recognition',
})
const answer = await protocolRequest(ctx, 'responses', {
  model: 'deepseek-flash', input: [{ role: 'user', content: [
    { type: 'input_text', text: 'Summarize this document' },
    { type: 'input_file', file_id: uploaded.id },
  ] }],
})
const audio = await synthesizeSpeech(ctx, { text: 'Hello', voice_id: 'stella' })
```

`file` accepts a `Blob`, `Uint8Array`, host-resolved `AssetRef`, or `{ base64 }`.
File names are explicit. Upload fields keep `purpose` before `file` as required
for document parsing. `recognizeDocument()` returns every raw OCR page,
including `finish_reason`, and `transcribeSpeech()` returns text and duration.
Files, OCR and speech limits are validated by the upstream service; consult
[Files](https://api-docs.deepseek.com/guides/files_api/),
[OCR](https://api-docs.deepseek.com/guides/ocr/), and
[ASR](https://api-docs.deepseek.com/guides/asr/) before submitting large inputs.

`protocolRequest()` returns complete JSON for Responses, Messages, FIM and Chat
Completions. A final assistant message with `prefix: true` selects the Beta Chat
Completions endpoint. `protocolResponse()` exposes the original `Response`,
including SSE when `stream: true`; the caller must consume the stream and check
the protocol's successful terminal event. MCP protocol tools return JSON and
reject `stream: true`. Native responses preserve citations, signatures, tool
history and file blocks without reshaping them.

The standalone Search API currently searches web pages; image search is only
available through the model's built-in web tools, as stated in the
[Search guide](https://api-docs.deepseek.com/guides/search/).

## Incremental TTS

`textToSpeech()` returns the HTTP audio stream. `synthesizeSpeech()` collects it
into a file output and detects empty audio and RIFF length truncation where the
header supplies a known length. PCM and unknown-length streams do not provide
an application-level completion marker.

For text arriving incrementally, use `streamTts(ctx, chunks, connect, options)`.
Supply a `DeepseekTtsConnect` connector that authenticates using the supplied
headers and preserves WebSocket text versus binary frames:

```ts
import { streamTts, type DeepseekTtsConnect } from 'modelbay/deepseek'

// Your host's WebSocket implementation must support headers and text frames.
const connect: DeepseekTtsConnect = async (url, headers) => {
  const socket = await hostConnect(url, headers)
  return {
    sendText: (text) => socket.sendText(text),
    receive: () => socket.receiveTextOrBinary(),
    close: () => socket.close(),
  }
}
for await (const audioFrame of streamTts(ctx, ['Hello ', 'world'], connect, { format: 'pcm' })) {
  await hostPlayAudio(audioFrame)
}
```

The connector's `receive()` returns `string` for text frames and `Uint8Array`
for audio, and rejects when a closed connection cannot return another frame.
The helper sends JSON text chunks and `finish_text`, closes on cancellation,
and only finishes successfully after `finish` with `code: success`.
Opus output contains packets without an Ogg container. The wire protocol and
service limits are in the [TTS guide](https://api-docs.deepseek.com/guides/tts/).
