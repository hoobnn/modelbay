# @modelbay/mcp

MCP tool generator and per-platform stdio servers for [Modelbay](https://github.com/hoobnn/modelbay#readme). MIT licensed.

`@modelbay/mcp` derives tools from Modelbay's declarations and serves them over stdio. Each
connection also publishes [Agent Skills](https://agentskills.io/) for its available workflows.

## Command

One command serves every platform that ships MCP tools; the platform is the first argument:

```sh
npx -y @modelbay/mcp ark            # or: modelbay-mcp ark
```

| Platform        | Argument        | Required keys (any one row)                                                    |
| --------------- | --------------- | ------------------------------------------------------------------------------ |
| Volcengine Ark  | `ark`           | `ARK_API_KEY`, or `ARK_AGENT_PLAN_API_KEY`                                     |
| MiniMax         | `minimax`       | `MINIMAX_API_KEY`                                                              |
| Alibaba Bailian | `bailian`       | `BAILIAN_API_KEY` (alias `DASHSCOPE_API_KEY`), or `BAILIAN_TOKEN_PLAN_API_KEY` |
| Doubao Speech   | `doubao-speech` | `DOUBAO_API_KEY`, or `DOUBAO_APP_ID` + `DOUBAO_ACCESS_TOKEN`                   |
| OpenAI          | `openai`        | `OPENAI_API_KEY`                                                               |
| DeepSeek        | `deepseek`      | `DEEPSEEK_API_KEY`                                                             |

Ark has two billing channels. Prefix the model with `ark-plan:` to use the Agent Plan
(`ARK_AGENT_PLAN_API_KEY`, `/api/plan/v3`) and `ark:` for pay-per-use (`ARK_API_KEY`). A model
without a prefix goes to the channel it is declared in, preferring pay-per-use when both keys are
set; with only the plan key configured, calls without a model use the plan.

Bailian works the same way for text chat: `bailian-plan:` (or a model only offered in the Token
Plan, such as `qwen4-max-preview`) uses `BAILIAN_TOKEN_PLAN_API_KEY` and the Token Plan endpoint.
Token Plan keys are for interactive use inside coding and agent tools only, so plan models are
marked `agentOnly`.

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

`MODELBAY_MCP_GROUPS` accepts a comma-separated list of groups. The selection applies to
tool calls, help, discovery and Skill references.

| Group        | Default | Contents                                                                  |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `core`       | yes     | generation, query and local/introspection tools                           |
| `realtime`   | no      | realtime session open/send/receive/close                                  |
| `management` | no      | console, hotword tables, task deletion, raw request                       |
| `node`       | no      | capabilities that require the optional `node:` subpath (e.g. file upload) |

Example: `MODELBAY_MCP_GROUPS=core,realtime modelbay-mcp doubao-speech`.

## Skills over MCP

Connect a platform with the command above. Clients that support the [MCP Skills extension](https://skills.extensions.modelcontextprotocol.io/)
can discover the Skills from the server and load them when needed. Each Skill has a `SKILL.md`
and a `references/tools.md` derived from the same tools exposed by `tools/list`.

Workflows cover model selection, image and video generation, audio, transcription, voice creation
and async job recovery. A workflow appears when the connection exposes one of its entry tools.
The platform argument and `MODELBAY_MCP_GROUPS` select which tools appear in its reference.

Claude Code documents MCP Skills support starting with v2.1.331 on [supported setups](https://code.claude.com/docs/en/mcp#where-mcp-skills-are-supported).
Clients can also browse the Skill files through standard MCP resources.

## Output directory

File results are saved when a call passes `out_dir` (or `output_directory`). Set
`MODELBAY_MCP_OUT_DIR` to save every call that doesn't: files go to `<dir>/<platform>`, for example
`MODELBAY_MCP_OUT_DIR=~/Downloads/modelbay` saves Ark results under `~/Downloads/modelbay/ark`.
Without either, images and audio come back as MCP `image` / `audio` blocks.

Codex only passes whitelisted variables to MCP servers, so add `MODELBAY_MCP_OUT_DIR` to the
server's `env_vars` list in `~/.codex/config.toml`.

## How tools are generated

- Each platform package defines its tools in `src/mcp/tools.ts` (`ToolSpec[]`): field shapes,
  platform switches and parameter descriptions, plus routing hints (`capability`, `native`,
  `nature`, `group`, `modelParams`). No model IDs, limits, defaults or lifecycle strings.
- The **model part** of each `inputSchema` — model IDs, defaults, per-model limits and lifecycle
  notices — is derived at startup from the platform's `ModelDeclaration`s via `@modelbay/core`.
  Editing a declaration changes the generated tools; nothing is hardcoded.
- `annotations` are derived from the tool's `nature` (`generate` / `query` / `mutate` / `local` /
  `realtime`).
- Shared capabilities use the same tool name on every platform (`generate_image`,
  `text_to_speech`, `clone_voice`, `design_voice`, `get_job`, ...).

See [`docs/mcp.md`](https://github.com/hoobnn/modelbay/blob/main/docs/mcp.md) for tool generation and Skill authoring details in Chinese.

## JSON-RPC methods

`server/discover` provides discovery for MCP `2026-07-28`. Clients on earlier protocol revisions
use `initialize`. Both can call `ping`, `tools/list`, `tools/call`, `skills/list`, `skills/get`,
`resources/list` and `resources/read`. `resources/templates/list` and `prompts/list` return empty
lists. Stdio accepts newline-delimited JSON and `Content-Length` frames and responds using the same
framing as the request. Logs go to **stderr**.

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
`test/baselines/` (59 tools), a real stdio smoke test (child process + pipes), and unit tests for
schema derivation, group switches, routing and error paths.
