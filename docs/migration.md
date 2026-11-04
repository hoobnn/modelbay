# M5：从 PyPI 老包迁移到 Modelbay

> 本文是 M5（停掉老包）的准备文档，写清迁移提示文案、README 应指向的新命令、停包清单
> 与 1.0 的前提。PyPI 老包「发最后一版」与 1.0 发布由维护者批准执行；实施 agent
> 不执行 `npm publish`、不打发布标签。

## 1. 四个待停的 PyPI 老包

数据来源：`hoobnn-mcps` 各 `servers/<平台>/pyproject.toml` 的 `[project]` 与
`[project.scripts]`，2026-11-04 核对。

| 平台       | PyPI 包名            | 当前版本 | 原命令名（`[project.scripts]`） | 迁移后的新命令               |
| ---------- | -------------------- | -------- | ------------------------------- | ---------------------------- |
| 火山方舟   | `volcengine-ark-mcp` | 0.6.5    | `volcengine-ark-mcp`            | `modelbay-ark-mcp`           |
| MiniMax    | `hoobnn-minimax-mcp` | 0.3.2    | `hoobnn-minimax-mcp`            | `modelbay-minimax-mcp`       |
| 阿里云百炼 | `ali-bailian-mcp`    | 0.7.4    | `ali-bailian-mcp`               | `modelbay-bailian-mcp`       |
| 豆包语音   | `doubao-speech-mcp`  | 0.5.3    | `doubao-speech-mcp`             | `modelbay-doubao-speech-mcp` |

原命令与包名同名，来自各 `pyproject.toml` 的 `[project.scripts]`，例如
`volcengine-ark-mcp = "volcengine_ark_mcp.server:main"`。新命令来自
[目标与里程碑](goals.md) 的 M4：每个平台一个 `@modelbay/mcp` 命令
（`modelbay-ark-mcp`、`modelbay-minimax-mcp`、`modelbay-bailian-mcp`、
`modelbay-doubao-speech-mcp`）。

## 2. 启动时应显示的迁移提示文案

最后一版在 MCP server 启动时向 stderr 打印一次：不阻断、不联网、不打印任何 key。
统一模板如下（尖括号处按第 1 节逐包替换）：

```text
[modelbay] <包名> <版本> 已停止维护，不再发布功能更新或安全修复。
请改用 Modelbay 的 MCP 命令 <新命令>（由 @modelbay/mcp 从声明生成）。
安装与配置见 Modelbay 仓库 README。
迁移说明：https://github.com/ikuyu-labs/modelbay/blob/main/docs/migration.md
本版本仅用于提示迁移，请勿继续依赖。
```

逐包填入后的首行与命令：

- 方舟：`[modelbay] volcengine-ark-mcp 0.6.5 已停止维护……请改用 modelbay-ark-mcp`
- MiniMax：`[modelbay] hoobnn-minimax-mcp 0.3.2 已停止维护……请改用 modelbay-minimax-mcp`
- 百炼：`[modelbay] ali-bailian-mcp 0.7.4 已停止维护……请改用 modelbay-bailian-mcp`
- 豆包语音：`[modelbay] doubao-speech-mcp 0.5.3 已停止维护……请改用 modelbay-doubao-speech-mcp`

提示只做一次，且在读取配置、连接上游之前打印；即使后续启动失败，用户也能看到。

## 3. 老包 README 应指向的新命令

每个老包最后一版的 README 顶部放一段迁移说明，明确写出新命令名，并把原来的
`[project.scripts]` 命令标为已停用。建议替换文案：

```text
# DEPRECATED — 已停止维护

本包（<包名> <版本>）不再维护。请改用 Modelbay 的 MCP 命令 <新命令>：

- 新命令：<新命令>（@modelbay/mcp，npm 侧）
- 原命令：<原命令名> 已停用
- 迁移说明：https://github.com/ikuyu-labs/modelbay/blob/main/docs/migration.md

Modelbay 用一份 TypeScript 实现取代 hoobnn-mcps（Python）与
plein/packages/providers 两份重复对接代码，MCP 工具从模型声明派生。
```

四个包分别把 `<新命令>` 换成 `modelbay-ark-mcp`、`modelbay-minimax-mcp`、
`modelbay-bailian-mcp`、`modelbay-doubao-speech-mcp`，`<原命令名>` 换成第 1 节
对应的原命令。README 不要再给出原命令的安装或运行示例，避免用户继续沿用。

## 4. 停包清单

按 M4 的迁移顺序（方舟 → MiniMax → 百炼 → 豆包语音）逐个停，一次一个：

1. 确认该平台的新命令已在 Claude Code 里实际跑通，工具清单与
   `docs/inventory/mcp-<平台>.json` 基线逐项对照，能力不缩水（G2）。
2. 给对应 PyPI 包发「最后一版」：只加第 2 节的启动提示与第 3 节的 README 迁移说明，
   不改业务逻辑、不发新功能。
3. 在 PyPI 项目页把包标记为 deprecated，描述里指向新命令与迁移文档。
4. 确认没有下游仍依赖该包后停止维护，不再响应 issue / 发版。
5. 四个包全部停完后，归档 `hoobnn-mcps` 仓库（设为只读）。
6. 把上游文档监控从 `hoobnn-mcps/scripts/upstream_docs.py` 切到本仓库的
   `scripts/upstream-docs.mjs` 与 `.github/workflows/upstream-docs.yml`（沿用 cron
   `23 2 * * *`、四平台 matrix、变化开 issue 由人工审核）。老仓库的对应定时任务关掉。

待停的四个包即第 1 节表格所列的 `volcengine-ark-mcp`、`hoobnn-minimax-mcp`、
`ali-bailian-mcp`、`doubao-speech-mcp`；`hoobnn-mcps` 仓库本身在最后归档。

## 5. 发 1.0 的前提

**发 1.0 的前提：plein 和 MCP 都只依赖 Modelbay**，也就是 0001 里的「唯一一份实现」：

- plein 的 `packages/providers` 只剩包装层，不再有请求构造与响应解析代码，全部走
  `@modelbay/core` 与各适配器（M3 验收）。
- 四个 MCP 命令都由 `@modelbay/mcp` 从声明 + 适配器生成，Python 版 MCP 已停止维护
  （M4、M5 验收）。
- `pnpm verify` 全绿，声明与 `docs/inventory/plein-models.json` 逐项比对无遗留差异，
  上游文档监控已迁到本仓库定时任务。
- 所有 `@modelbay/*` 与 `modelbay` 已经用同一个版本号（changesets fixed 组）发过 0.x，
  并开启 npm provenance。

满足以上条件后由维护者决定 1.0，版本号仍按 changesets 的 fixed 组统一升。

## 6. 发布纪律

**每次发布需维护者批准，实施 agent 不执行 `npm publish`**，也不打发布标签。

- `.github/workflows/release.yml` 只由 `workflow_dispatch` 手动触发；publish job 绑定
  受保护的 GitHub Environment `release`（required reviewers），维护者批准后才执行。
- 配置里不存在「推到 main 就自动 `npm publish`」的路径：不配置 `push: branches: [main]`
  触发，CI（`.github/workflows/ci.yml`）只跑 `pnpm verify`，不含发布。
- changesets 的 Version Packages PR 由维护者用 `pnpm changeset` / `pnpm version-packages`
  生成并合并；发布用 `pnpm exec changeset publish` 并开启 provenance
  （`NPM_CONFIG_PROVENANCE`、OIDC `id-token: write`）。
- 上游文档定时任务只开 issue/PR 交人工审核，不自动改声明、不合并、不发布。
- 实施 agent 的工作到「准备好配置与文档」为止；实际发版、打 tag、停 PyPI 包均由维护者执行。
