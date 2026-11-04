# 目标、范围与里程碑

为什么这么分层见 [0001](decisions/0001-single-implementation-architecture.md)。本文写的是要做到什么、不做什么，以及每一步怎样才算完成。

## 要解决的问题

火山方舟、豆包语音、阿里云百炼、MiniMax 这几家上游经常改参数、上下线模型。现在 `hoobnn-mcps`（Python）和 `plein/packages/providers`（TypeScript）各维护一份对接代码，同一处变化两边都要改，两边对同一个模型的说明也开始不一致。

## 目标

| 编号 | 目标 | 怎么判断达成 |
| --- | --- | --- |
| G1 | 一处修改，处处生效 | 上游改一个参数范围、默认值或模型状态，只需改一个声明文件和它的测试。plein 的表单和预检、MCP 的工具 schema 都从声明派生，不用再动别处 |
| G2 | 能力不缩水 | 迁移完成时，[盘点](inventory.md)里两边已有的能力都能用。MCP 侧以 `docs/inventory/mcp-*.json` 的工具清单为准逐个对照 |
| G3 | 别的项目接入容易 | 外部 TypeScript 项目只装 `modelbay` 并配好 key，十行以内就能调通生图、生视频、配音中的任意一种，异步任务的轮询由 SDK 处理 |
| G4 | 核心不绑定运行时 | `@modelbay/core` 能在 Node、Bun、Deno 和浏览器里加载。Node 专属能力只出现在可选子路径 |
| G5 | 上游变化能被发现 | 每个模型声明都记着官方文档来源。上游文档一变，能定位到受影响的声明（工具在里程碑 5 之后做） |

## 不做的事

- **HTTP 网关和托管服务。** 等第一个非 TypeScript 消费方出现再说（见 0001）。
- **画布相关的东西。** 节点、端口、插件清单、审批都留在 plein 的 `plugin-sdk`。
- **迁移完成前不加新平台。** 先做 0001 里的五家，不追求 LiteLLM 那样的覆盖面。
- **不从文档自动生成声明。** 声明由人核对官方原文后手写，工具只负责发现变化。
- **不做 Python SDK。** Python 版 MCP 迁移完就停止维护。
- **不管计费、配额和密钥。** SDK 只上报用量，key 由宿主传入，SDK 不负责存储。
- **不负责结果的下载和入库。** 结果只返回 URL 或字节（见 0001）。

## 里程碑

每个里程碑拆成一个或几个 PR。每个 PR 都要写清楚改了什么、怎么验证，并附上验证命令的输出。里程碑之间按顺序做，前一个验收通过后再开始下一个。

### M1：core 落地，plein 改为依赖它

把 plein `packages/plugin-sdk/src` 里与 provider 相关的类型和校验搬进 `@modelbay/core`：

- 整个搬：`provider.ts`、`model-params.ts`、`media-requirements.ts`、`image-input.ts`、`video-input.ts`，以及它们的测试；
- 只搬被它们依赖的部分：`ids.ts`、`ports.ts` 里的 `AssetRef`、`reference-tokens.ts`；
- 和插件身份绑定的部分（例如 `describeProvider` 需要插件 id、`providerTestScope`）留在 plein。实施时如果拿不准，在 PR 里列出来，由审核决定。

验收：

1. 在 modelbay 仓库里，`pnpm verify` 通过（见 [工程规范](engineering.md#命令)）。从 plein 搬来的测试全部保留并通过。
2. core 的类型检查不加载 Node 类型，也没有 `node:` 导入（规则见工程规范）。
3. `@plein/plugin-sdk` 改为从 `@modelbay/core` 再导出这些符号，plein 其他代码的 import 一行不改。`PLUGIN_API_VERSION` 不变。
4. plein 分支上 `pnpm verify` 通过。
5. 发布前，plein 分支用本地链接引用 core（方法见工程规范）。合进 plein 的 main 之前，`@modelbay/core` 必须先在 npm 发出 0.x 版本，plein 改成依赖这个版本号。**发布要等维护者批准。**

### M2：声明抽取

- 写脚本，把 plein 各适配器里的 `ModelSpec` 抽成独立的声明文件。格式按 0003，原始数据对照 `docs/inventory/plein-models.json`。
- 现有的 `deprecated: true` 要逐个对照官方原文，映射成 0003 里的生命周期状态，不能一律映射成 `retired`。查不到官方原文的，在 PR 里列出来。
- 补上声明自检（见工程规范的测试分层）。

验收：

- 导出的 JSON 和 `plein-models.json` 逐项比对；有差异的，每一处都要在 PR 里说明原因。
- 每个声明都带着来源链接和核对日期。

### M3：搬适配器

- 方舟（按量 + 套餐）、百炼、MiniMax、豆包语音、OpenAI，以及 OpenAI 兼容渠道，都搬进各自的包。plein 的 `packages/providers` 只保留包装层。
- 百炼的 Qwen-Audio-TTS（SpeechSynthesizer 协议）、ASR、音色复刻和设计，从 MCP 的 Python 实现移植过来。
- 文本对话按 0001 的要求，逐家确认平台特有字段能原样透传。确认结果记进对应适配器的文档。

验收：

- plein 现有的 provider 测试全部通过。
- plein 的 `packages/providers` 里不再有请求构造和响应解析的代码。

### M4：MCP 生成器与逐平台迁移

- `@modelbay/mcp` 从声明和适配器生成 MCP 工具，每个平台一个命令：`modelbay-<平台>-mcp`。
- 按方舟、MiniMax、百炼、豆包语音的顺序，一次迁一个平台。

验收：

- 每迁一个平台，工具清单都和 `docs/inventory/mcp-<平台>.json` 逐个对照。对不上的工具，要么补齐，要么在 PR 里说明为什么不做。
- 迁过来的平台，在 Claude Code 里用新命令实际跑通一次。

### M5：停掉老包

- PyPI 上每个包发最后一版，启动时提示迁移，README 指向新命令。
- `hoobnn-mcps` 的上游文档监控迁过来或改成定时任务（见 0001 的未决事项）。
- 发 1.0 的前提：plein 和 MCP 都只依赖 Modelbay。
