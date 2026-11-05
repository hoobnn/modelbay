# @modelbay/mcp

MCP tool generator and per-platform stdio servers for [Modelbay](../../README.md). MIT licensed.

`@modelbay/mcp` derives MCP tools from `ModelDeclaration` data and `@modelbay/core` schemas, and
serves them over a minimal stdio JSON-RPC transport. It does **not** depend on
`@modelcontextprotocol/sdk` or any other new runtime dependency.

## Command

One command serves every platform that ships MCP tools; the platform is the first argument:

```sh
npx -y @modelbay/mcp ark            # or: modelbay-mcp ark
```

| Platform        | Argument        | Required keys (any one row)                                  |
| --------------- | --------------- | ------------------------------------------------------------ |
| Volcengine Ark  | `ark`           | `ARK_API_KEY`, or `ARK_AGENT_PLAN_API_KEY`                   |
| MiniMax         | `minimax`       | `MINIMAX_API_KEY`                                            |
| Alibaba Bailian | `bailian`       | `BAILIAN_API_KEY` (alias `DASHSCOPE_API_KEY`)                |
| Doubao Speech   | `doubao-speech` | `DOUBAO_API_KEY`, or `DOUBAO_APP_ID` + `DOUBAO_ACCESS_TOKEN` |

The platform list, key names and aliases come from each platform package's `PlatformDescriptor`;
running `modelbay-mcp` without an argument prints the available platforms. Keys are supplied by the
host through environment variables and never stored. When a key is missing, `tools/list` still
works and `tools/call` returns an error naming the missing variables.

### Node-only capabilities

Some capabilities need Node-only implementations (object-storage uploads, `sharp` mask
processing). They live in the platform packages' optional subpaths and are loaded and injected
automatically at launch through `modelbay/node` (each subpath exports `nodeOptions`):

| Platform | Subpath                        | Injected option                                   | Capability                                        |
| -------- | ------------------------------ | ------------------------------------------------- | ------------------------------------------------- |
| Ark      | `@modelbay/ark/node`           | `uploadVideo`, `transcribePlan`, `listPlanModels` | video reference upload, plan ASR, plan model list |
| Bailian  | `@modelbay/bailian/node`       | `edit`, `process`                                 | `image.edit`, `image.process`                     |
| Doubao   | `@modelbay/doubao-speech/node` | `asr`, `interpretation`                           | streaming ASR, simultaneous interpretation        |

The optional peer dependencies (`@volcengine/tos-sdk`, `sharp`, `ws`) are imported lazily inside
those subpaths, so a missing dependency never stops the server from starting — the call that needs
it fails with an explicit "install X" error instead. When a subpath cannot be loaded at all, the
adapter is created without that option and the affected capability reports which subpath to inject.

Ark's reference-video upload additionally needs the storage configuration, read from the same
environment: `ARK_REFERENCE_STORAGE` (`tos` / `oss` / `cos` / `s3`), `ARK_REFERENCE_BUCKET`,
`ARK_REFERENCE_REGION`, and optionally `ARK_REFERENCE_ENDPOINT` and `ARK_REFERENCE_PATH_STYLE`,
plus the key pair `ARK_TOS_ACCESS_KEY` / `ARK_TOS_SECRET_KEY`. These are optional: without them the
server still starts and only the video-reference path is unavailable.

## Tool groups

`MODELBAY_MCP_GROUPS` (comma separated) controls which groups are exposed by `tools/list`:

| Group        | Default | Contents                                                                  |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `core`       | yes     | generation, query and local/introspection tools                           |
| `realtime`   | no      | realtime session open/send/receive/close                                  |
| `management` | no      | console, hotword tables, task deletion, raw request                       |
| `node`       | no      | capabilities that require the optional `node:` subpath (e.g. file upload) |

Example: `MODELBAY_MCP_GROUPS=core,realtime modelbay-mcp doubao-speech`.

## How tools are generated

- Each platform package defines its tools in `src/mcp/tools.ts` (`ToolSpec[]`): field shapes,
  platform switches and parameter descriptions, plus routing hints (`capability`, `native`,
  `nature`, `group`, `modelParams`, `aliases`). No model IDs, limits, defaults or lifecycle strings.
- The **model part** of each `inputSchema` — model IDs, defaults, per-model limits and lifecycle
  notices — is derived at startup from the platform's `ModelDeclaration`s via `@modelbay/core`.
  Editing a declaration changes the generated tools; nothing is hardcoded.
- `annotations` are derived from the tool's `nature` (`generate` / `query` / `mutate` / `local` /
  `realtime`).
- MiniMax tools (`text_to_audio`, `text_to_image`, `voice_clone`, `voice_design`) are also exposed
  under the names the other platforms use.

Details (in Chinese): [`docs/mcp.md`](../../docs/mcp.md).

## JSON-RPC methods

`initialize`, `ping`, `tools/list`, `tools/call`; plus `resources/list`,
`resources/templates/list`, `prompts/list` (empty, protocol completeness). Framing supports both
newline-delimited JSON (MCP stdio standard) and `Content-Length` headers. Responses use the same
framing as the request. All logs go to **stderr** so stdout is never polluted.

`tools/call` routes to `PlatformAdapter.submit` (normalized capabilities) or
`PlatformAdapter.native` (single-platform ops); local introspection tools are answered in-process.

## Programmatic use

```ts
import { generateTools, listTools, createServer, createHandlers, MCP_TOOL_GROUPS } from '@modelbay/mcp'

const set = generateTools('ark', { adapter: arkAdapter }) // or pass a PlatformDescriptor
const tools = listTools(set, MCP_TOOL_GROUPS.all) // every tool, including optional groups
```

## Testing

`vp test run packages/mcp` runs the parity tests against the frozen tool-list snapshots in
`test/baselines/` (70 tools), a real stdio smoke test (child process + pipes), and unit tests for
schema derivation, group switches, routing and error paths.
