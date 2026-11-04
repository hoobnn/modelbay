# 工程规范

这里写的是怎么写代码、怎么测试、怎么发布。高成本的取舍记在 [ADR](decisions/README.md)，做到什么程度算完成见 [目标与里程碑](goals.md)。

## 工具链

工具链和 plein 保持一致，这样 plein 那边的代码搬过来时不用改风格，也不用改测试。

| 项 | 选择 |
| --- | --- |
| Node | `>=24`，`.node-version` 写 `26` |
| 包管理 | pnpm workspace，根 `package.json` 写 `"packageManager": "pnpm@12.11.2"` |
| lint / 格式化 / 测试 / 打包 | Vite+（`vite-plus`，用 `vp check`、`vp test`、`vp pack`），版本和 plein 的 catalog 一致 |
| TypeScript | `^7`，`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`，直接照搬 plein 的 `tsconfig.base.json` |
| 文档检查 | `markdownlint-cli` |
| 提交检查 | husky + commitlint，配置照搬 plein 的 `commitlint.config.cjs`；pre-commit 跑 `vp staged` |
| 版本管理 | changesets |

格式化规则照搬 plein `vite.config.ts` 里的 `fmt` 段：单引号、不加分号、行宽 100。lint 规则用 plein 那套去掉 React 和 a11y 的部分，同样开启 `typeAware`。

## 目录

```text
packages/
  core/            @modelbay/core
  ark/             @modelbay/ark（方舟按量 + 套餐两个渠道）
  bailian/         @modelbay/bailian
  minimax/         @modelbay/minimax
  doubao-speech/   @modelbay/doubao-speech
  openai/          @modelbay/openai（也包含 OpenAI 兼容渠道）
  modelbay/        modelbay（汇总入口，只做再导出和默认注册）
  mcp/             @modelbay/mcp
  cli/             @modelbay/cli
scripts/           仓库级脚本：声明导出、依赖许可检查等
docs/
```

各平台包的内部结构：

```text
src/
  index.ts         公开入口
  models/          模型声明，一个模型一个文件，纯数据
  *.ts             鉴权、路由、请求和响应映射、错误码映射
  node/            只能在 Node 下用的部分，从子路径导出（例如 @modelbay/ark/tos）
test/fixtures/     录制好的请求和响应
```

M1 只建 `core`，其他包到了对应的里程碑再建。

## 包的规则

- 只发 ESM。用 `vp pack` 构建到 `dist/`，同时产出 `.d.ts`。`exports` 只指向 `dist`，`sideEffects: false`。
- 发布前，每个包都要过 `publint` 和 `@arethetypeswrong/cli`，确保外部项目装上就能直接用。
- `zod` 作为 `peerDependency`（`^4.6`）：plein 会把 core 的 schema 和自己的 schema 混在一起用，装出两份 zod 会出错。
- 只允许 MIT、Apache-2.0、BSD、ISC 许可的依赖。`scripts/` 里放一个许可检查脚本，接进 `verify`。
- 新增运行时依赖要在 PR 里说明用途。core 尽量不加依赖。

## 代码规则

### core 不绑定运行时

- `packages/core/tsconfig.json` 设 `"types": []`、`"lib": ["ES2023", "DOM"]`。这样不加载 Node 类型，用到 `Buffer`、`process` 之类的东西，类型检查就会报错。
- 在 core 里用 lint 禁止 `node:*` 和 `sharp`、`fs`、`@volcengine/tos-sdk` 的导入。
- 只用 `fetch`、`Uint8Array`、`ReadableStream`、`AbortSignal`、`crypto.subtle` 这类各运行时都有的 API。

### 声明

- 格式按 [0003](decisions/0003-capabilities-and-model-declarations.md)。文件写 `export default { ... } satisfies ModelSpec`，不允许写函数、条件分支或从别处计算出来的值。
- 每个声明都要有 `source: { url, checkedAt }`。`checkedAt` 是实际读官方原文的日期，格式 `YYYY-MM-DD`。
- 默认模型由 core 统一选，只能选 `active` 状态的模型。适配器和消费方都不能自己写默认值。

### 错误和日志

- 所有失败都抛 `ProviderError`，错误码沿用 plein 现有的 `ProviderErrorCode`。上游的原始错误码和信息放进 `cause` 或 `details`，不要直接丢掉。
- 库代码不写 `console.*`。进度和用量通过事件钩子上报（见 0001）。
- 错误信息、日志和测试快照里不能出现 key。录制夹具时脱敏（见下文）。

### 注释和文档语言

- 公开 API 的 TSDoc、各包 README、根 README 用英文，给外部使用者看。
- `docs/` 下的设计文档和代码里的内部注释用中文，和 plein、hoobnn-mcps 保持一致。

## 测试

| 层 | 内容 | 什么时候跑 |
| --- | --- | --- |
| 单元测试 + 录制夹具 | 请求构造、响应解析、错误映射，用 `test/fixtures/` 里的录制数据，不联网 | 每次提交，`vp test` |
| 声明自检 | 每个声明都能生成合法的 JSON Schema；都有 `source`；默认模型都是 `active`；别名不冲突 | 每次提交，`vp test` |
| 真实冒烟 | 每家用最便宜的一档跑一次真实调用 | 夜间。key 放在哪、预算多少还没定（见 0001），M3 之前不做 |

- 夹具用 JSON，每个文件记一次请求和响应。录制时 `Authorization`、签名、key 和账号 ID 一律替换成 `<redacted>`。
- 从 plein 搬过来的测试保留原来的断言，只改 import 路径。
- 覆盖率门槛：`packages/core` 行覆盖不低于 90%，平台包不低于 80%。搬过来时如果达不到，在 PR 里写明现状，不要为了凑数补测试。

## 命令

根 `package.json` 里提供这些脚本：

| 命令 | 做什么 |
| --- | --- |
| `pnpm lint` | `vp check` + markdownlint |
| `pnpm typecheck` | `pnpm -r typecheck` |
| `pnpm test` | `vp test` |
| `pnpm build` | `pnpm -r build`（各包内是 `vp pack`） |
| `pnpm verify` | `pnpm dedupe --check`、lint、typecheck、带覆盖率门槛的 test、build、publint、attw、许可检查，全部按顺序跑 |

PR 合并前，`pnpm verify` 必须通过。CI（GitHub Actions）跑的就是这一条命令。

## 和 plein 联调

- plein 的 main 分支只能依赖已经发布的 `@modelbay/*` 版本号。
- 发布之前，在 plein 的功能分支里用 pnpm 的 `link:` 指向本地的 `../modelbay/packages/<包名>`。这个改动不能合进 plein 的 main。
- 每做完一个涉及 plein 的里程碑，在 plein 那边单独开一个 PR，验收标准按 [目标与里程碑](goals.md) 里写的执行。

## Git

- 不直接往 main 提交。一个改动一个分支，通过 PR 合并。分支名用 `<type>/<短描述>`，例如 `feat/core-provider-types`。
- 提交信息格式：`<emoji> type(scope): 中文 subject`，由 commitlint 检查。scope 用包名去掉 `@modelbay/` 前缀（`core`、`ark`、`bailian`、`minimax`、`doubao-speech`、`openai`、`mcp`、`cli`、`modelbay`），仓库级改动用 `repo`，纯文档用 `docs`。
- 加 `Co-Authored-By` trailer，写当前 agent 自己的署名行。不加会话链接，也不加「Generated with」之类的标语。
- 改了对外行为的 PR 要附一个 changeset。

## 版本与发布

- 所有 `@modelbay/*` 和 `modelbay` 用同一个版本号（changesets 的 `fixed` 组），外部使用者只需要记一个版本。
- M5 之前都是 `0.x`。不兼容的改动升次版本号，兼容的新增和修复升修订号。1.0 的条件见目标文档 M5。
- 发布通过 GitHub Actions 进行，开启 npm provenance。**每次发布都要维护者批准**，实施的 agent 不能自己执行 `npm publish`，也不能打发布标签。
