# 实施契约（并行开发用）

本文是实施阶段的接口约定，供各并行任务共同遵守。设计取舍见 [0001](decisions/0001-single-implementation-architecture.md) 和 [0003](decisions/0003-capabilities-and-model-declarations.md)，做到什么程度算完成见 [目标与里程碑](goals.md)。

## 环境

- 工作目录 `/Users/haobin/Code/personal/active/modelbay`。
- 参考资料（只读）：同级目录 `plein/`（TypeScript 实现）和 `hoobnn-mcps/`（Python MCP 实现）。
- Node 用 `/opt/homebrew/opt/node@26/bin` 下的 26；pnpm 12.11.2；工具链是 Vite+（`vp`）。
- 各并行任务**不要运行** `pnpm install`、`pnpm verify`、`pnpm build`，也不要修改根目录配置、`packages/core/**` 或 `scripts/check-*.mjs`（另有授权除外）。统一由整合者安装、构建、排错。

## 文件所有权

| 任务              | 可以写                                                                                                                                                              | 不要写                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| core-tests        | `packages/core/src/*.test.ts`（只新增测试文件）                                                                                                                     | core 实现文件、任何配置                                                   |
| declarations (M2) | `scripts/export-declarations.mjs`、`scripts/compare-inventory.mjs`、`scripts/check-declarations.mjs`、`declarations/**`、各包 `src/models/**`                       | 各包 `package.json` / `tsconfig.json` / `vite.config.ts` / `src/index.ts` |
| adapters-a (M3)   | `packages/ark/**`、`packages/openai/**`（`src/models/**` 除外），含这两个包的 `package.json` / `vite.config.ts`                                                     | 其他包、根配置、core                                                      |
| adapters-b (M3)   | `packages/bailian/**`、`packages/minimax/**`、`packages/doubao-speech/**`（`src/models/**` 除外），含这三个包的 `package.json` / `vite.config.ts`                   | 其他包、根配置、core                                                      |
| mcp (M4)          | `packages/mcp/**`（含其 `package.json` / `vite.config.ts`）                                                                                                         | 其他包、根配置、core                                                      |
| entry (M5)        | `packages/modelbay/**`、`packages/cli/**`、`docs/migration.md`、`scripts/upstream-docs.mjs`、`.github/workflows/upstream-docs.yml`、`.github/workflows/release.yml` | 其他包、根配置、core                                                      |

## core 公共 API

`@modelbay/core` 已落地，导出以下模块（子路径同名，例如 `@modelbay/core/declarations`）：

- `provider`：从 plein 原样搬来的 `Capability`（9 种）、`ModelSpec`、`ModelInfo`、`ModelLimits`、`MediaRequirements`、`ProviderError`、`ProviderErrorCode`、`ProviderOutput`、`SubmitResult`、`PollResult`、`CapabilityInput`、`VoicePreset`、`ProviderRequest`、`ProviderContext`、`defineProvider`、`providerConfigured` 等。
- `model-params` / `media-requirements` / `image-input` / `video-input`：原有校验函数。
- `ids` / `ports` / `media` / `reference-tokens`：上述文件的依赖片段。
- `capabilities`：`NormalizedCapability`（13 种 = 9 种 + `voice.clone` / `voice.design` / `voice.list` / `text.embed`）、`NORMALIZED_CAPABILITIES`、`NATIVE_OPERATIONS`、`native()`、`RealtimeSession`。
- `declarations`：`ModelDeclaration`、`Lifecycle`、`LifecycleStatus`、`ModelSource`、`ChannelRef`、`ModelAliases`、`validateDeclaration()`、`isSelectable()`、`canBeDefault()`、`selectDefaultModel()`、`resolveModel()`、`customModel()`、`toModelInfo()`、`lifecycleNotice()`、`ModelRegistry`。
- `schema`：`capabilityInputSchema()`、`declarationJsonSchema()`、`isValidJsonSchema()`、`allCapabilitySchemas()`。
- `runtime`：`ModelbayHooks`、`emitUsage()`、`emitProgress()`、`JobStore`、`InMemoryJobStore`、`runJob()`、`AssetSource`、`UrlAssetSource`、`toBase64()`、`fromBase64()`、`redact()`、`redactHeaders()`。
- `adapter`：`PlatformAdapter`、`AdapterRequest`、`AdapterContext`、`defineAdapter()`、`createAdapterContext()`、`adapterCapabilities()`。

`core` 的 `tsconfig.json` 是 `types: []`、`lib: ["ES2023", "DOM"]`，**不能**出现 `node:` 导入、`Buffer`、`process`、依赖 `sharp` / `fs` / TOS SDK。

## 声明格式（0003）

每个模型一个纯数据文件，写在 `packages/<平台>/src/models/<模型>.ts`：

```ts
import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'minimax/speech-2.8-hd',
  id: 'speech-2.8-hd',
  title: 'MiniMax Speech 2.8 HD',
  capabilities: ['audio.speech'],
  channels: [
    { channel: 'minimax', id: 'speech-2.8-hd' },
    { channel: 'bailian', id: 'MiniMax/speech-2.8-hd' },
  ],
  aliases: { official: [], short: ['hd'] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://platform.minimax.cn/docs/api-reference/music-generation', checkedAt: '2026-11-04' },
  },
  source: { url: 'https://platform.minimax.cn/docs/api-reference/music-generation', checkedAt: '2026-11-04' },
} satisfies ModelDeclaration
```

规则：只允许字面量，不允许函数、条件分支、从别处计算的值；每个声明都要有 `source` 和 `lifecycle.source`，`checkedAt` 为 `YYYY-MM-DD`；`retired` 不可选、非 `active` 不可当默认；默认模型只能由 `selectDefaultModel()` / `ModelRegistry.defaultFor()` 选，消费方不得自行写死。

原始数据 [`docs/inventory/plein-models.json`](inventory/plein-models.json) 共 7 个 provider、84 个模型（含 8 个 mock），其中 76 个是静态模型声明。`deprecated: true` 必须逐条对照官方原文映射成生命周期状态，不能一律 `retired`；`docs/inventory.md` 第三节已核对三条：`music-3.0` → `closed-to-new-accounts`（`since: 2026-08-20`）、Seedream 5.0 Lite 两个 ID → `sunsetting`（`sunsetOn: 2026-11-24`）、百炼 `qwen3-tts-flash` 保持 `active` 但不当默认、`qwen-audio-3.0-tts-flash` → `superseded`（`by: qwen-audio-3.1-tts-flash`）。

导出 JSON 放在 `declarations/<平台>/<模型>.json`，与 `plein-models.json` 逐项比对，差异写进 `docs/declaration-diff.md`。

## 适配器契约

每个平台包导出 `defineAdapter()` 定义的对象（类型 `PlatformAdapter`）：

```ts
import { defineAdapter, type PlatformAdapter } from '@modelbay/core'
import * as models from './models/index'

export const arkAdapter: PlatformAdapter = defineAdapter({
  id: 'volc/ark',
  title: 'Volcengine Ark',
  channels: ['ark', 'ark-plan'],
  models: models.all,
  nativeOperations: ['...'],
  async submit(request, ctx) { /* 请求构造、鉴权、错误映射 */ },
  async poll(remoteId, ctx) { /* 响应解析 */ },
  async native(op, params, ctx) { /* 单平台独有 */ },
})
```

- 所有失败抛 `ProviderError`，错误码沿用 `ProviderErrorCode`，上游原始错误码/信息放进 `cause` 或 `details`；不写 `console.*`。
- 只用 `ctx.fetch`（由宿主注入，便于夹具测试），不直接调全局 `fetch`；`ctx.secret(name)` 取 key，SDK 不存储 key。
- 请求构造、响应解析、错误码映射必须有录制夹具测试，夹具是 JSON，`Authorization`、签名、key、账号 ID 一律 `<redacted>`。
- Node 专属代码（TOS 上传、`node:zlib`、`sharp` 等）放到 `src/node/` 并从包的可选子路径导出，不要放进根入口。
- `@modelbay/doubao-speech` 需要导出 `speechSettings`、`synthesizeSpeech`、`TTS_VOICES`（方舟套餐的 TTS 复用它）；这是唯一允许的跨适配器依赖，方向 ark → doubao-speech。
- 平台包行覆盖率门槛 80%，`packages/core` 90%。

## MCP 工具生成（M4）

- `docs/inventory/mcp-*.json` 是**最小基线**：方舟 9、百炼 19、豆包语音 24、MiniMax 18，共 70 个工具。
- 以 `MCP_TOOL_GROUPS` 之类的开关控制默认暴露的工具组；实时会话、管理工具、需 `node:` 的能力放可选组，默认不启用。
- 生成器从 `ModelDeclaration` + `capabilityInputSchema()` 派生 inputSchema，平台特有字段由适配器声明的 native 参数补充；不要硬编码模型参数、上下限或默认值。
- 对照测试逐个检查基线工具名和关键 schema 字段都存在；实现超出基线的工具要在 `docs/mcp-tool-diff.md` 里列出并说明原因（G2 允许能力不缩水，但不允许少）。
- 跨平台同名工具统一命名，MiniMax 的 `text_to_audio` / `text_to_image` / `voice_clone` / `voice_design` 等别名要保留兼容。
- 每个平台一个命令：`modelbay-ark-mcp`、`modelbay-minimax-mcp`、`modelbay-bailian-mcp`、`modelbay-doubao-speech-mcp`（M4 迁移顺序按 goals.md：方舟 → MiniMax → 百炼 → 豆包语音）。

## 汇总入口与 CLI

- `modelbay` 包只做再导出与默认注册，不含平台逻辑；十行以内调通生图、生视频、配音中的任意一种，异步轮询由 `runJob()` 处理（G3）。
- `key` 由宿主传入，SDK 只上报用量；结果只返回 URL 或字节，下载和入库由宿主负责。

## 验收脚本

`pnpm verify` 顺序：`dedupe --check` → `lint` → `typecheck` → `test:coverage` → `check:coverage` → `check:declarations` → `build` → `check:packages`（publint + attw）→ `check:licenses` → `check:core-runtime`。所有脚本在 `scripts/`，由整合者统一跑通。
