# Modelbay：Agent 工作入口

本文件供 Claude Code、Codex 等 agent 读取，只放导航和硬规则，专题内容写进 `docs/`。

## 现状

一份 TypeScript 实现覆盖火山方舟、阿里云百炼、MiniMax、豆包语音和 OpenAI，SDK、MCP、CLI 都从同一份模型声明派生。功能已齐，尚未发布 0.x。对外只发 `modelbay`、`@modelbay/mcp`、`@modelbay/cli` 三个包，其余是不发布的内部包，见 [0005](docs/decisions/0005-three-published-packages.md)，见 [目标与范围](docs/goals.md)。

平台包自描述：每个平台包导出一个 `PlatformDescriptor`，汇总入口、MCP、CLI 都只遍历 `packages/modelbay/src/platforms.ts` 里的注册表。新增平台只动它自己的包和注册表，见 [扩展指南](docs/extending.md)。

## 从哪里开始

| 要做的事                             | 先读                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| 加模型、加平台、加能力、加 MCP 工具  | [扩展指南](docs/extending.md)                                      |
| 工具链、目录、测试、命令、提交与发布 | [工程规范](docs/engineering.md)                                    |
| 要做到什么、现在做到哪               | [目标与范围](docs/goals.md)                                        |
| MCP 工具怎么从声明生成               | [MCP 工具生成](docs/mcp.md)                                        |
| 上游文档对账、审对账 issue 和 PR     | [上游文档对账](docs/upstream.md)                                   |
| 为什么这么分层                       | [0001](docs/decisions/0001-single-implementation-architecture.md)  |
| 声明格式和生命周期                   | [0003](docs/decisions/0003-capabilities-and-model-declarations.md) |
| 平台描述与注册表                     | [0004](docs/decisions/0004-platform-descriptors-and-registry.md)   |
| 为什么只发三个包                     | [0005](docs/decisions/0005-three-published-packages.md)            |
| 做高成本取舍                         | [决策记录规则](docs/decisions/README.md)                           |

## 硬规则

- 模型参数、上下限、默认值、生命周期只写在声明数据里，代码不硬编码。
- 改声明要附官方来源链接和核对日期；没核对过官方原文的状态不写进声明。
- `@modelbay/core` 和各平台包的根入口只能用各运行时都有的 API，Node 专属依赖放到 `/node` 子路径。
- 平台包之间不互相依赖（唯一例外：方舟依赖豆包语音），公共代码放 `@modelbay/shared`。
- 内部包标 `private`，不发布；发布包的依赖和产物里不能引用它们（`pnpm check:packages` 检查）。`@modelbay/mcp`、`@modelbay/cli` 只从 `modelbay` 导入。
- 许可证是 MIT。不要引入 AGPL / GPL 依赖。
- 不执行 `npm publish`，也不打发布标签。发布要维护者批准。
- 合并前 `pnpm verify` 必须通过。PR 里附上验证命令的输出。
