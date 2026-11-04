# 工具目录（M4 最小基线）

本目录下的 `ark.ts` / `minimax.ts` / `bailian.ts` / `doubao-speech.ts` 是数据文件，
由 `packages/mcp/scripts/gen-catalog.mjs` 从 `docs/inventory/mcp-*.json` 生成，请勿手工编辑。
重新生成后请运行 `vp check --fix packages/mcp/src/catalog` 恢复仓库统一的格式（单引号 / 行宽 100）。

- 来源：hoobnn-mcps（Python MCP）/ plein（TypeScript providers）的盘点清单，见 `docs/inventory.md`。
- 核对日期：**2026-11-04**（逐个平台对照官方原文后写入声明，本目录只镜像工具清单）。
- 数量：方舟 9、MiniMax 18、百炼 19、豆包语音 24，共 **70** 个工具（G2「能力不缩水」的基线）。
- 迁移顺序按 `docs/goals.md` M4：方舟 → MiniMax → 百炼 → 豆包语音。

每个条目只保留 `name` / `description` / `inputSchema` / `outputSchema`：

- `inputSchema` 里的 `model` 字段带基线默认值，只是「平台特有字段」的占位；运行时的 `model` 字段
  由 `src/derive.ts` 从 `ModelDeclaration` + `capabilityInputSchema()` / `declarationJsonSchema()`
  重新派生并覆盖，生成器代码不硬编码模型 ID / 上下限 / 默认值 / 生命周期。
- **不保存 `annotations`**：基线条目有缺 `destructiveHint` 的情况，运行时由能力元数据（`ToolNature`）
  重新派生四个 hint，见 `src/derive.ts` 的 `deriveAnnotations()`。

`manifest.json` 记录各平台对应的盘点文件与工具数，供测试与 `docs/mcp-tool-diff.md` 对照。
