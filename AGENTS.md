# Modelbay：Agent 工作入口

本文件供 Claude Code、Codex 等 agent 读取，只放导航和硬规则，专题内容写进 `docs/`。

## 现状

项目处于设计阶段，还没有代码。目标是用一份 TypeScript 实现，取代 `hoobnn-mcps`（Python）和 `plein/packages/providers` 这两份重复的平台对接代码。

## 从哪里开始

| 要做的事 | 先读 |
|---|---|
| 了解为什么做、整体怎么分层 | [0001 单一实现与四层架构](docs/decisions/0001-single-implementation-architecture.md) |
| 命名、许可、npm / GitHub 命名空间 | [0002](docs/decisions/0002-naming-license-and-namespaces.md) |
| 新增能力、写或改模型声明 | [0003](docs/decisions/0003-capabilities-and-model-declarations.md) |
| 查现有两份实现覆盖了什么 | [盘点](docs/inventory.md) |
| 做高成本取舍 | [决策记录规则](docs/decisions/README.md) |

## 硬规则

- 模型参数、上下限、默认值、生命周期只写在声明数据里，代码不硬编码。
- 改声明要附官方来源链接和核对日期；没核对过官方原文的状态不写进声明。
- 核心包 `@modelbay/core` 只能用各运行时都有的 API，Node 专属依赖放到适配器的可选子路径。
- 许可证是 MIT。不要引入 AGPL / GPL 依赖。
