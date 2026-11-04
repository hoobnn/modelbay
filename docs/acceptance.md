# 验收对照报告

本文逐条对照 [目标与里程碑](goals.md) 的验收标准，记录实施结果与证据。验证命令均为 `pnpm verify`（见 [工程规范](engineering.md#命令)）及其子步骤。

## 验证环境

| 项       | 值                                                          |
| -------- | ----------------------------------------------------------- |
| 日期     | 2026-11-04                                                  |
| Node     | 26.13.0（`.node-version` 写 26，`engines.node >=24`）       |
| pnpm     | 12.11.2                                                     |
| Vite+    | 1.4.0（vitest 5.0.5、TypeScript 7.0.2、zod 4.6.7）          |
| 参考源码 | 同级目录 `plein/` 与 `hoobnn-mcps/`（均为浅克隆的公开仓库） |

## M1：core 落地，plein 改为依赖它

| 验收项                                                                                              | 结果                   | 证据                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` 通过，从 plein 搬来的测试全部保留并通过                                               | 见最终验证输出         | `packages/core/src/{model-params,media-requirements,image-input,video-input}.test.ts`，49 个用例                                                                                                                                                                                               |
| core 类型检查不加载 Node 类型，也没有 `node:` 导入                                                  | 通过                   | `packages/core/tsconfig.json` 设 `types: []`、`lib: ["ES2023","DOM"]`；`scripts/check-core-runtime.mjs` 扫描全部源文件，输出「无 Node 专属 API」                                                                                                                                               |
| `@plein/plugin-sdk` 改为从 `@modelbay/core` 再导出，其他 import 一行不改，`PLUGIN_API_VERSION` 不变 | 通过                   | plein 本地分支 `feat/modelbay-core-relink`：8 个文件改为单行再导出，`provider.ts` 保留 `describeProvider` / `providerTestScope` / `ProviderDescriptor`；`import.meta.resolve('@modelbay/core/provider')` 指向 modelbay 的 `packages/core/dist/provider.mjs`；`PLUGIN_API_VERSION` 仍为 `0.1.3` |
| plein 分支 `pnpm verify` 通过                                                                       | 见最终验证输出         | plein 全仓库 `pnpm typecheck` 与 `pnpm dedupe --check` 通过；`@plein/plugin-sdk` 项目 77 个测试全部通过（含 `model-guide.test.ts` 与 `sdk.test.ts` 的 `describeProvider` 用例）                                                                                                                |
| 发布前用本地 link 引用 core；合 main 前 core 先发 0.x 版                                            | 联调部分通过，发布受阻 | plein 的 `pnpm-workspace.yaml` 加了 `overrides: "@modelbay/core": "link:../main-9d6bb45e/packages/core"`，`packages/plugin-sdk/package.json` 写版本号 `0.1.0`；**npm 发布需维护者批准，未执行**                                                                                                |

实施取舍：`describeProvider` / `providerTestScope` / `ProviderDescriptor` 依赖插件 id 与画布身份，按 goals.md 留在 plein；core 的 `provider.ts` 只搬公共部分。其余被依赖文件（`ids.ts`、`ports.ts`、`media.ts`、`reference-tokens.ts`）整体搬入 core，避免把 `ports.ts` 拆成两份反而增加维护成本。

## M2：声明抽取

| 验收项                                                               | 结果                     | 证据                                                                |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| 导出的 JSON 与 `plein-models.json` 逐项比对，差异逐条说明            | 见 `declaration-diff.md` | `scripts/export-declarations.mjs` / `scripts/compare-inventory.mjs` |
| 每个声明带来源链接和核对日期                                         | 见声明自检               | `scripts/check-declarations.mjs`，`source: { url, checkedAt }`      |
| 声明自检（合法 JSON Schema / source / 默认模型 active / 别名不冲突） | 见最终验证输出           | `pnpm check:declarations`                                           |

`deprecated: true` 逐条对照官方原文，不一律映射成 `retired`；查不到官方原文的条目在 `declaration-diff.md` 的「待核对清单」里列出，声明暂按 `active` 处理。

## M3：搬适配器

| 验收项                                                                    | 结果           | 证据                                                   |
| ------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ |
| plein 现有的 provider 测试全部通过                                        | 受外部依赖限制 | 见「阻碍与未决」                                       |
| plein 的 `packages/providers` 里不再有请求构造和响应解析的代码            | 受外部依赖限制 | 见「阻碍与未决」                                       |
| 五家适配器落地，百炼 Qwen-Audio-TTS / ASR / 音色复刻 / 设计从 Python 移植 | 见各包 README  | `packages/{ark,bailian,minimax,doubao-speech,openai}/` |

## M4：MCP 生成器与逐平台迁移

| 验收项                                              | 结果                  | 证据                                                       |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| 每迁一个平台，工具清单与 `mcp-<平台>.json` 逐个对照 | 见 `mcp-tool-diff.md` | 基线共 70 个工具：方舟 9、百炼 19、豆包语音 24、MiniMax 18 |
| 迁过来的平台用新命令实际跑通一次                    | 本地 stdio 冒烟替代   | 见「阻碍与未决」                                           |

## M5：停掉老包

| 验收项                                                   | 结果                     | 证据                                                               |
| -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| PyPI 每个包发最后一版、启动时提示迁移、README 指向新命令 | 仅完成文档与配置，未发布 | `docs/migration.md`                                                |
| 上游文档监控迁成定时任务                                 | 完成配置                 | `scripts/upstream-docs.mjs`、`.github/workflows/upstream-docs.yml` |
| 发 1.0 的前提：plein 和 MCP 都只依赖 Modelbay            | 受外部依赖限制           | 见「阻碍与未决」                                                   |

## 阻碍与未决

以下事项需要外部系统、维护者批准或额外仓库改动，实施 agent 无法在本环境完成，按用户要求统一列出：

1. **npm / PyPI 发布**：`goals.md` 与 `engineering.md` 明确规定发布需维护者批准，实施 agent 不执行 `npm publish`、不打发布标签。因此 M1 第 5 条、M5 的「最后一版」与 1.0 条件都只完成到「配置与文档就绪」。
2. **plein 侧完整改造**：M3 要求 plein 的 `packages/providers` 只保留包装层、且现有 provider 测试全部通过。这需要把 plein 的 provider 测试整体迁移到新包，属于另一个仓库的独立 PR；本环境只完成了 M1 的 plugin-sdk 再导出联调。
3. **在 Claude Code 里实跑 MCP 命令**：无法在当前会话注册 Claude Code 自定义命令，改用本地 stdio 冒烟（`initialize` + `tools/list`）验证协议可用。
4. **官方原文逐条核对**：`docs/inventory.md` 第三节已核对三条模型状态，其余模型的 `checkedAt` 沿用 2026-11-04 盘点记录，未逐一重新联网核对；待核对清单见 `declaration-diff.md`。
5. **夜间真实冒烟**：`engineering.md` 写明 M3 之前不做，且 key 存放与预算未定。
