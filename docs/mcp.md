# MCP 工具生成

`@modelbay/mcp` 把注册表里带 `mcp` 的平台变成 MCP server，命令是 `modelbay-mcp <平台>`。工具定义分两层：平台包只写与模型无关的部分，与模型有关的部分在启动时从声明派生。

## 两层来源

| 层               | 写在哪                                             | 内容                                                                                   |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 平台特有部分     | `packages/<平台>/src/mcp/tools.ts`（`ToolSpec[]`） | 字段形状、平台开关、参数说明；`capability`、`native`、`nature`、`group`、`modelParams` |
| 与模型有关的部分 | 运行时由 `packages/mcp/src/derive.ts` 从声明派生   | `model` 的可选 ID 与默认值、随模型变化的参数范围、说明里的模型清单与生命周期提示       |

工具定义里不出现模型 ID、上下限数值、默认值或生命周期字符串。改一份声明，MCP 的 schema 和说明就跟着变，`packages/mcp/test/declaration-driven.test.ts` 在内存里改声明并断言生成结果随之变化。

`modelParams` 写明哪些参数随模型变化（`duration`、`resolution`、`aspectRatio`、`count`、`seed`、`speed`、`promptLength`、`references`），由 core 的 `deriveModelParam()` 从 `ModelLimits` / `MediaRequirements` 翻译成 JSON Schema 约束。声明 `optionsSchema` 里的上下限和默认值只增不覆盖地并入。

## 路由与元数据

每个工具最终落到三种路由之一：

- `submit`：按归一化能力调 `adapter.submit()`，能力取工具定义的 `capability`，没写就按通用工具名约定推断。
- `native`：工具定义写了 `native: '<op>'`，调 `adapter.native(op, params)`。只有一家平台有的能力走这条。
- `local`：MCP 自己回答，不联网（`get_tool_help`、`list_capabilities`、`list_jobs`、`get_job`、`list_voices` 等）。处理器实现在 `@modelbay/mcp`，工具名约定在 `src/tool-meta.ts`。

`src/tool-meta.ts` 只放跨平台通用的工具名约定（同名工具在各平台语义一致）。平台独有的工具在自己的 `tools.ts` 里写 `native` / `nature` / `group`，优先于通用约定，所以新增平台独有工具不需要改 `@modelbay/mcp`。

## annotations

四个 hint 全部从 `nature` 派生，工具定义里不手写：

| nature   | readOnly | destructive | idempotent | openWorld |
| -------- | -------- | ----------- | ---------- | --------- |
| generate | false    | false       | false      | true      |
| query    | true     | false       | true       | true      |
| mutate   | false    | true        | false      | true      |
| local    | true     | false       | true       | false     |
| realtime | false    | false       | false      | true      |

删除、关闭、控制台、热词表、音色升级这类操作标 `mutate`。

## 工具组

`MODELBAY_MCP_GROUPS`（逗号分隔）控制 `tools/list` 暴露哪些组，默认只有 `core`。

| 组           | 默认   | 放什么                                                      |
| ------------ | ------ | ----------------------------------------------------------- |
| `core`       | 启用   | 生成、查询、本地只读工具                                    |
| `realtime`   | 不启用 | 实时会话（豆包语音 `*_realtime_*`）                         |
| `management` | 不启用 | 删除任务、控制台、热词表、原始请求、2K 再生成等管理操作     |
| `node`       | 不启用 | 需要本地文件 I/O 的工具；适配器 `nodeOnly` 里的操作强制归入 |

## 统一工具名与额外工具

- 同一个归一化能力在所有平台用同一个工具名：`generate_image`、`generate_video`、`text_to_speech`、`clone_voice`、`design_voice`、`get_job`……每个能力只注册一个工具，不提供同义名。
- 每个平台额外有一个 `list_declared_models`：列出声明里的模型、能力和生命周期提示，客户端不用硬编码模型清单。它不叫 `list_models`，因为百炼的 `list_models` 是官方模型目录查询，语义不同。工具名要符合 `^[a-zA-Z0-9_-]{1,64}$`，所以不用带冒号的名字。
- `resources/list`、`resources/templates/list`、`prompts/list` 返回空集合，避免部分客户端探测时报 `-32601`。

## `voice.list` 的命名

`voice.list` 是归一化能力，三家都支持，但工具名不统一：MiniMax 和百炼有 `list_voices`（百炼另有 `get_voice`），豆包语音只有按 `speaker_id` 查单个音色的 `get_voice`。这里没有给豆包伪造 `list_voices`。要不要三家同名还没定。

## 工具清单快照

`packages/mcp/test/baselines/<平台>.json` 是 2026-11-04 冻结的工具清单快照（方舟 9、MiniMax 18、百炼 19、豆包语音 24，共 70 个）。`test/tools.test.ts` 打开全部工具组后逐个对照：快照里的工具名都在，`inputSchema` 的关键字段和 `required` 都保留，四个 hint 齐全，防止重构时工具或字段悄悄丢失。新增平台不需要快照。
