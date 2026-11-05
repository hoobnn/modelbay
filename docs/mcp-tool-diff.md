# MCP 工具对照（M4）

本文记录 `@modelbay/mcp` 生成的 `tools/list` 与最小基线的逐平台对照结果，以及所有超出基线的实现。

- 基线来源：`docs/inventory/mcp-*.json`（hoobnn-mcps / plein 盘点）。
- 核对日期：**2026-11-04**（与声明数据的核对日期一致）。
- 对照脚本：`packages/mcp/test/tools.test.ts`，直接读取 `docs/inventory/mcp-*.json`，
  对 `generateTools()` + `listTools(..., MCP_TOOL_GROUPS.all)` 的结果逐项比较。
- 迁移顺序按 `docs/goals.md` M4：方舟 → MiniMax → 百炼 → 豆包语音。

## 盘点文件与平台 key 的对应

| 平台 key        | 命令                         | 基线文件                  | 基线工具数 |
| --------------- | ---------------------------- | ------------------------- | ---------- |
| `ark`           | `modelbay-ark-mcp`           | `mcp-volcengine-ark.json` | 9          |
| `minimax`       | `modelbay-minimax-mcp`       | `mcp-minimax.json`        | 18         |
| `bailian`       | `modelbay-bailian-mcp`       | `mcp-ali-bailian.json`    | 19         |
| `doubao-speech` | `modelbay-doubao-speech-mcp` | `mcp-doubao-speech.json`  | 24         |
| **合计**        |                              |                           | **70**     |

## 对照结果

「全量」= 启用全部工具组（含别名与新增工具）；「默认」= 只启用 `core` 组。

| 平台                   | 基线   | 全量生成 | 默认暴露 | 基线缺失 | 超出基线                                  |
| ---------------------- | ------ | -------- | -------- | -------- | ----------------------------------------- |
| 方舟 ark               | 9      | 10       | 10       | **0**    | `list_declared_models`                    |
| MiniMax                | 18     | 23       | 19       | **0**    | 4 个统一命名别名 + `list_declared_models` |
| 百炼 bailian           | 19     | 20       | 20       | **0**    | `list_declared_models`                    |
| 豆包语音 doubao-speech | 24     | 25       | 17       | **0**    | `list_declared_models`                    |
| **合计**               | **70** | **78**   | **66**   | **0**    | 8                                         |

结论（G2「能力不缩水」）：**70 个基线工具全部存在**，无缺失。测试同时断言：

- 每个基线 `inputSchema` 的关键字段都存在且类型一致（`type` / `anyOf` 形态保持，`required` 保留）；
- `annotations` 四个 hint 齐全且均为 boolean；
- 工具名无重复，生成数量不少于基线。

## 超出基线的工具（按 G2 允许「能力不缩水」，需说明原因）

### 1. `list_declared_models`（四个平台各 1 个，共 4 个）

- 类型：MCP 本地工具（`local` 处理器 `models`，`core` 组，只读、不联网、不计费）。
- 原因：把「有哪些模型、各处于什么生命周期」从 `ModelDeclaration` 派生出来给客户端，
  避免客户端硬编码模型清单或默认值；与 G1「一处修改，处处生效」一致。
  返回 `canonicalId` / `capabilities` / `status` / `lifecycleNotice()` 提示。
- 命名：MCP 客户端（Claude 等）对工具名的约束是 `^[a-zA-Z0-9_-]{1,64}$`，带冒号的名字会被拒绝，
  所以不用 `models:list`。也不叫 `list_models`——那是百炼基线里的官方模型目录查询，语义不同。

### 2. MiniMax 统一命名别名（4 个）

MiniMax 历史工具名与其余平台不一致。为满足「跨平台同名工具统一命名」又「保留兼容」，
保留历史名作为主工具，并额外注册一个统一命名的别名工具（同 inputSchema、同 route、同 group，
`aliasOf` 指向主工具）：

| 历史名（基线保留） | 新增统一命名别名 | 对齐到                       |
| ------------------ | ---------------- | ---------------------------- |
| `text_to_audio`    | `text_to_speech` | 百炼 / 豆包 `text_to_speech` |
| `text_to_image`    | `generate_image` | 方舟 / 百炼 `generate_image` |
| `voice_clone`      | `clone_voice`    | 百炼 / 豆包 `clone_voice`    |
| `voice_design`     | `design_voice`   | 百炼 / 豆包 `design_voice`   |

`chat` / `generate_image` / `generate_video` / `get_job` / `get_tool_help` / `list_capabilities` /
`list_jobs` / `recover_job` 等跨平台同名工具直接沿用同名，且 `annotations` 派生结果一致
（测试逐平台比对）。

### 3. 超出基线的 MCP 协议方法（非 tools/list 工具）

`resources/list`、`resources/templates/list`、`prompts/list` 返回空集合。

- 原因：MCP 协议完整性——部分客户端在 `initialize` 后会探测这些能力；返回空集合可避免
  `-32601 Method not found`。Modelbay 不托管资源/提示词模板，故为空。不计入 70 个工具基线。

## 工具组（默认不启用可选组）

`MODELBAY_MCP_GROUPS` 控制 `tools/list` 暴露哪些组，默认只有 `core`。
G2 的「不缩水」按**全量能力**核对（测试中启用全部组），默认隐藏只是运行期开关，不是能力缺失。

| 组           | 默认   | 工具                                                                                                                                                        |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`       | 启用   | 生成 / 查询 / 本地只读工具                                                                                                                                  |
| `realtime`   | 不启用 | 豆包语音 `open_realtime_session` / `send_realtime_event` / `receive_realtime_events` / `close_realtime_session`                                             |
| `management` | 不启用 | MiniMax `delete_video_task` / `list_video_tasks` / `regenerate_video`；豆包 `manage_word_table` / `speech_console` / `speech_raw_request` / `upgrade_voice` |
| `node`       | 不启用 | MiniMax `upload_file`（需 `node:` 可选子路径做本地文件 I/O）                                                                                                |

补充规则：适配器 `PlatformAdapter.nodeOnly` 里声明的 native 操作会被强制归入 `node` 组。
方舟、百炼基线中没有可选组工具，故其「默认」数量等于「全量」。

## annotations 不照抄基线

基线条目存在缺 `destructiveHint` 的情况（例如 MiniMax `list_video_tasks`）。生成器按能力元数据
`ToolNature`（`generate` / `query` / `mutate` / `local` / `realtime`）重新派生四个 hint，
一律齐全：

| nature   | readOnly | destructive | idempotent | openWorld |
| -------- | -------- | ----------- | ---------- | --------- |
| generate | false    | false       | false      | true      |
| query    | true     | false       | true       | true      |
| mutate   | false    | **true**    | false      | true      |
| local    | true     | false       | true       | false     |
| realtime | false    | false       | false      | true      |

删除 / 关闭 / 控制台 / 热词表 / 升级等破坏性或管理操作标 `destructiveHint: true`，
修正了基线里的缺失。

## inputSchema 的模型参数部分如何派生

- 平台特有字段来自 `src/catalog/*.ts`（由 `scripts/gen-catalog.mjs` 从基线 JSON 生成）。
- `model` 字段的默认值与说明由 `src/derive.ts` 从 `ModelDeclaration` +
  `capabilityInputSchema()` / `declarationJsonSchema()` / `selectDefaultModel()` / `lifecycleNotice()`
  派生：保留基线字段的形状（`type: string` 或 `anyOf`），只替换硬编码默认值与说明；
  声明 `optionsSchema` 带来的上下限 / 默认值只增不覆盖地并入。
- 生成器代码不含任何模型 ID、上下限数值、默认值或生命周期字符串字面量（AGENTS.md 硬规则）。

## `voice.list` 语义与工具名说明

0003 把 `voice.list` 定为归一化能力，三家平台在语义上都支持「列/查音色」，但**工具名只两家有**：

- MiniMax、百炼：工具名 `list_voices`（百炼另有 `get_voice` 查单个音色）；
- 豆包语音：基线里只有 `get_voice`（按 `speaker_id` 查单个音色），没有 `list_voices`。

为遵守 G2，基线工具名原样保留，未擅自把豆包的 `get_voice` 改名或伪造 `list_voices`；
`list_voices` / `get_voice` 统一由本地 `voices` 处理器从声明的 `voices` 派生回答。
如需三家完全同名，待上游/维护者确认 `voice.list` 的归一化语义后再统一，属 M5 之后的取舍。

## 复现与验收命令

```bash
# 单元测试 + 基线对照 + stdio 冒烟（不联网）
vp test run packages/mcp

# 单包类型检查（根 tsconfig.base.json 已配 paths / allowImportingTsExtensions，无需先 build）
pnpm --filter @modelbay/mcp typecheck

# 重新生成工具目录（改了 docs/inventory/mcp-*.json 后；源码用无后缀相对导入）
node scripts/gen-catalog.mjs && vp check --fix packages/mcp/src/catalog

# 覆盖率（pnpm test:coverage 全量跑时 packages/mcp 行覆盖不低于 80% 门槛）
```

stdio 冒烟由 `vpx -s scripts/stdio-smoke-child.ts` 起真实子进程（用项目自带 Vite+ 解析器
加载 TS，无需 .ts 后缀、无需先 build），在 OS 管道上跑 initialize / tools/list / ping。

验收状态：`vp test run packages/mcp` **92 项测试全部通过**；stdio 冒烟（子进程 + OS 管道）
对换行帧与 Content-Length 帧都通过；`pnpm --filter @modelbay/mcp typecheck`、`vp check`、
markdownlint 均通过；`packages/mcp/src/**` 行覆盖 **95.7%**（314/328，门槛 80%）。
