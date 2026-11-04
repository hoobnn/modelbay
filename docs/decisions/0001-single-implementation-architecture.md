# 0001：四家平台只保留一份实现，四层架构

- 状态：提议
- 日期：2026-11-04

## 背景

火山方舟、豆包语音、阿里云百炼、MiniMax 这四家平台，目前各有两份实现：

- `hoobnn-mcps`：Python，4 个 MCP server，共 70 个工具。
- `plein/packages/providers`：TypeScript，6 个平台、76 个静态模型声明。

上游一改参数或模型，两边都要修一遍。2026-08 到 11 月，plein 有 101 个提交动了 `providers`，大多是在补约束声明；同期 hoobnn-mcps 有 73 个提交，改得最多的是上游文档快照和审计。两份实现对同一个模型的说明已经出现不一致，详见 [盘点](../inventory.md#三模型状态核对)。

现成的统一 SDK 只解决了文本对话：四家都提供 OpenAI 兼容接口，Vercel AI SDK、LiteLLM 也都能用。视频、语音、复刻、异步任务和素材上传，各家差异很大，没有可用的开源实现。

## 决策

1. 新建独立仓库 Modelbay，用 TypeScript 维护这四家平台（外加 OpenAI）唯一的一份实现。plein 和 MCP 都只是它的消费方。命名和许可见 [0002](0002-naming-license-and-namespaces.md)。
2. 分四层：

   | 层         | 包                                                                                                       | 职责                                                                                                       |
   | ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | 核心运行时 | `@modelbay/core`                                                                                         | 能力类型、输入输出、错误归一化、HTTP（重试 / 超时 / 代理）、异步任务生命周期、按声明校验、素材上传策略接口 |
   | 模型声明   | 放在各适配器包内                                                                                         | 纯数据，格式见 [0003](0003-capabilities-and-model-declarations.md)                                         |
   | 平台适配器 | `@modelbay/ark`、`@modelbay/bailian`、`@modelbay/minimax`、`@modelbay/doubao-speech`、`@modelbay/openai` | 只写各家不同的部分：鉴权、路由、请求和响应映射、错误码映射                                                 |
   | 消费方     | `modelbay`（汇总入口）、`@modelbay/mcp`、`@modelbay/cli`，以及 plein 的插件包装                          | 不包含平台逻辑                                                                                             |

3. 文本对话（`text.chat`）走 Vercel AI SDK 的 OpenAI 兼容层，不再给每家写专门的对话适配。
4. 核心通过接口注入宿主差异，并自带默认实现：
   - `JobStore`：异步任务持久化。默认存内存或本地 JSON；plein 注入 SQLite。
   - `AssetSource`：输入素材的来源，可以是路径、字节或 URL。默认读本地文件。
   - 结果只返回 URL 或字节，下载和入库由宿主负责。
   - 事件钩子：回调进度和用量（token、秒数、字符数、张数）。
5. 画布相关的部分（节点、端口、manifest、审批）留在 plein 的 `plugin-sdk`，不进核心。

## 理由

- 上游变化最常见的是参数范围、默认值和新增模型。这些写成声明数据之后只改一处，表单、预检、MCP 工具 schema 都从声明派生。
- 选 TypeScript：plein 那份已经插件化，按模型声明了约束，测试也齐，是两份里更完整的一份。桌面端如果内嵌 Python 运行时，打包代价太高。
- 考虑过两边各留一份、只共享一份参数声明，没有采用：请求构造、轮询、下载还是得写两遍。

## 代价与约束

- hoobnn-mcps 从 PyPI 迁到 npm，老用户要换安装方式。Python 版发最后一版后停止维护，启动时提示迁移。
- 核心必须不依赖特定运行时，只用 `fetch`、`Uint8Array` 这类各运行时都有的 API。`sharp`、`fs`、`@volcengine/tos-sdk` 这类只能在 Node 下用的依赖，放到可选子路径（如 `@modelbay/ark/tos`）。这一条是迁移第 1 步的验收标准，事后再拆代价会大很多。
- 文本对话改走兼容层之前，要逐家确认平台特有的字段能原样透传，包括思考续传 `continuation`、`thinking`、联网搜索、`previous_response_id`。传不过去的，那一家仍保留一层薄适配。现状是：plein 的方舟和百炼已经走 `shared/llm.ts`（AI SDK），MiniMax 的对话是自己直接请求 `/v1/chat/completions`。
- 核心接口按 semver 管理，只加字段、不改语义。声明数据会导出成 JSON，供其他语言和 UI 使用。
- 非 TypeScript 的消费方（其他语言、浏览器、iOS 原生）以后通过 HTTP 网关接入，网关的 OpenAPI 由声明生成。第一个这类消费方出现之前不做网关。

## 迁移顺序

1. 把 `plugin-sdk` 里与 provider 相关的类型和校验（`provider.ts`、`model-params`、`media-requirements`、`image-input`、`video-input`）搬进 `@modelbay/core`。plein 改为依赖 core，行为不变。
2. 写脚本，把 plein 各适配器里的 `ModelSpec` 抽成声明文件，原始数据见 `docs/inventory/plein-models.json`。
3. 搬四个适配器和 OpenAI 适配器，plein 只保留包装层，现有测试全部通过。
4. 做 MCP 生成器，按平台逐个迁移。以 `docs/inventory/mcp-*.json` 的工具清单为对照验收，Python 版独有的能力在这一步补齐。
5. 停止维护 PyPI 上的老包。

第 1–3 步对外没有可见变化，最先做。第 3 步做完，plein 可以马上用上 MCP 那边已有的百炼新 TTS、ASR 和复刻能力。

## 未决事项

- 测试分三层：离线录制夹具（每次提交）、声明自检（每个声明都能生成合法 schema）、夜间真实冒烟（每家最便宜的一档）。夜间冒烟用的 key 放在哪、预算多少，还没定。
- 上游文档监控：`hoobnn-mcps/scripts/upstream_docs.py` 改成定时任务，检测到变化就开 issue，并指出受影响的模型声明。迁不迁到 TypeScript 还没定。
