# 工程规范

这里写的是怎么写代码、怎么测试、怎么发布。新增模型、平台、能力的步骤见 [扩展指南](extending.md)，高成本的取舍记在 [ADR](decisions/README.md)。

## 工具链

| 项                          | 选择                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Node                        | `>=24`，`.node-version` 写 `26`                                                         |
| 包管理                      | pnpm workspace，`"packageManager": "pnpm@12.11.2"`                                      |
| lint / 格式化 / 测试 / 打包 | Vite+（`vp check`、`vp test`、`vp pack`）；`vpx -s <file>.ts` 直接运行 TS，不用先 build |
| TypeScript                  | `^7`，`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`                      |
| 文档检查                    | `markdownlint-cli`                                                                      |
| 提交检查                    | husky + commitlint；pre-commit 对暂存文件跑 `vp check --fix` 和 `markdownlint --fix`    |
| 版本管理                    | changesets，所有包一个版本号                                                            |

格式化：单引号、不加分号、行宽 100。lint 开启 `typeAware`。配置都在根 `vite.config.ts`。

## 目录

```text
packages/
  core/            @modelbay/core：能力、声明、校验、任务运行、平台描述类型（运行时无关）
  shared/          @modelbay/shared：平台包共用的 HTTP、对话、尺寸、模型清单工具
  ark/             @modelbay/ark：火山方舟（按量 + 套餐两个渠道）
  bailian/         @modelbay/bailian：阿里云百炼
  minimax/         @modelbay/minimax
  doubao-speech/   @modelbay/doubao-speech：豆包语音
  openai/          @modelbay/openai：OpenAI 与 OpenAI 兼容渠道
  modelbay/        modelbay：汇总入口、平台注册表、modelbay/node
  mcp/             @modelbay/mcp：MCP server，命令 modelbay-mcp <平台>
  cli/             @modelbay/cli：命令 modelbay
scripts/           仓库级检查：覆盖率、包发布、许可、core 运行时隔离；upstream/ 是上游文档对账
docs/
vite.package.ts    各包共用的打包入口探测与测试别名
```

平台包的内部结构：

```text
src/
  index.ts         根入口，运行时无关
  platform.ts      平台描述对象（definePlatform）
  models/          模型声明，一个模型一个文件，纯数据；index.ts 汇总成 all
  mcp/tools.ts     MCP 工具定义（没有 MCP 的平台不建）
  node/            Node 专属实现，从 @modelbay/<平台>/node 导出 nodeOptions
  *.ts             鉴权、请求、响应映射、错误映射
test/
  *.test.ts        测试
  fixtures/        录制好的请求和响应
```

## 包的约定

- 只发 ESM。`vp pack` 构建到 `dist/`，同时产出 `.d.ts`。`exports` 只指向 `dist`，`sideEffects: false`。
- 打包入口按目录自动探测：`src/index.ts`，`src/node/index.ts`（或 `src/node.ts`），`src/bin/*.ts`。各包的 `vite.config.ts` 只有一行 `definePackageConfig(import.meta.url)`。
- 子路径只有两种：`"."` 和 `"./node"`。命令行入口放 `src/bin/`。
- 测试和类型检查直接解析源码：`@modelbay/<包>` → `src/index.ts`，`@modelbay/<包>/node` → `src/node/index.ts`。别名在 `vite.package.ts` 和 `tsconfig.base.json` 里统一配置，新包不用改。
- `zod` 是 `peerDependency`（`^4.6`）：宿主会把 core 的 schema 和自己的混用，装两份会出错。
- 只允许 MIT、Apache-2.0、BSD、ISC 许可的依赖。新增运行时依赖要在 PR 里说明用途。core 尽量不加依赖。
- 发布前每个包都要过 `publint` 和 `@arethetypeswrong/cli`（`pnpm check:packages`）。

## 代码规则

### core 不绑定运行时

- `packages/core/tsconfig.json` 设 `"types": []`、`"lib": ["ES2023", "DOM"]`，用到 `Buffer`、`process` 就报类型错误。
- 只用 `fetch`、`Uint8Array`、`ReadableStream`、`AbortSignal`、`crypto.subtle` 这类各运行时都有的 API。`scripts/check-core-runtime.mjs` 扫描源码兜底。
- 平台包的根入口同样运行时无关。`sharp`、文件系统、对象存储 SDK、WebSocket 只能出现在 `src/node/`，并写成可选 peer 依赖、惰性导入。

### 声明

- 格式见 [0003](decisions/0003-capabilities-and-model-declarations.md)，写法见 [扩展指南](extending.md#新增或修改一个模型)。
- 模型参数、上下限、默认值、生命周期只写在声明里。适配器、MCP、CLI 都不能写默认模型，由 core 的 `selectDefaultModel()` 只从 `active` 模型里选。
- TS 声明是唯一来源，不导出 JSON。上游文档对账直接从注册表读声明。

### 错误和日志

- 所有失败都抛 `ProviderError`。上游的原始错误码和信息放进 `cause` 或 `details`，不要丢掉。
- 库代码不写 `console.*`。进度和用量通过事件钩子上报。
- 错误信息、日志和测试快照里不能出现 key。

### 注释和文档语言

- 公开 API 的 TSDoc、各包 README、根 README 用英文。
- `docs/` 和代码内部注释用中文。

## 测试

- 测试放在各包的 `test/` 下（core 暂时和源码放在一起），只测行为，不联网。
- 请求构造、响应解析、错误映射用 `test/fixtures/` 里的录制数据，一个 JSON 文件记一次请求和响应。录制时把 `Authorization`、签名、key 和账号 ID 替换成 `<redacted>`。
- 声明自检在 `packages/modelbay/test/declarations.test.ts`，遍历注册表里的全部声明，新增模型不用写测试。
- MCP 的工具清单快照对照在 `packages/mcp/test/`，说明见 [MCP 工具生成](mcp.md)。
- 覆盖率按包统计：core 行覆盖不低于 90%，其余每个包不低于 80%（`scripts/check-coverage.mjs`）。`src/bin/` 不计入。
- 夜间真实冒烟（每家最便宜的一档跑一次真实调用）还没做，key 放在哪、预算多少未定。

## 命令

| 命令                  | 做什么                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm lint`           | `vp check` + markdownlint                                                                           |
| `pnpm format`         | 自动修复上面两项                                                                                    |
| `pnpm typecheck`      | 根目录（配置与脚本）和每个包的 `tsc`                                                                |
| `pnpm test`           | `vp test`                                                                                           |
| `pnpm build`          | 每个包 `vp pack`                                                                                    |
| `pnpm check:sources`  | 离线检查每个声明的来源都是白名单里的官方 https 地址并带核对日期                                     |
| `pnpm upstream:audit` | 现抓官方文档并与声明双向核对，报告写到 `.upstream-docs/`，见 [上游文档对账](upstream.md)            |
| `pnpm verify`         | dedupe、lint、typecheck、带覆盖率的测试、按包覆盖率、来源检查、build、包发布、许可、core 运行时隔离 |

PR 合并前 `pnpm verify` 必须通过，CI 跑的就是这一条。

## 上游文档对账

`.github/workflows/upstream-docs.yml` 每天跑一次：现抓官方文档，抽取模型清单和下线信息，与声明双向核对。差距进「上游文档对账：<平台>」跟踪 issue，下线公告点名的模型出生命周期补丁、开草稿 PR。仓库里不存文档内容，也不存上一次的结果。定时任务不合并、不发布。做法和处理差距的要点见 [上游文档对账](upstream.md)。

## 和下游项目联调

- 下游项目的主分支只能依赖已经发布的 `@modelbay/*` 版本号。
- 发布之前，在下游项目功能分支根目录的 `pnpm-workspace.yaml` 里加 `overrides`，例如 `"@modelbay/core": "link:../modelbay/packages/core"`，路径按下游项目根目录解析。这一行不能合进下游的主分支。

## Git

- 不直接往 main 提交。一个改动一个分支，通过 PR 合并。分支名用 `<type>/<短描述>`。
- 提交信息格式：`<emoji> type(scope): 中文 subject`，由 commitlint 检查。scope 用包名去掉 `@modelbay/` 前缀，仓库级改动用 `repo`，纯文档用 `docs`。
- 加 `Co-Authored-By` trailer，写当前 agent 自己的署名行。不加会话链接，也不加「Generated with」之类的标语。
- 改了对外行为的 PR 要附一个 changeset。

## 版本与发布

- 所有包同一个版本号（changesets 的 `fixed` 组按 `@modelbay/*` 和 `modelbay` 匹配，新包自动纳入）。
- 1.0 之前都是 `0.x`：不兼容的改动升次版本号，兼容的新增和修复升修订号。什么时候发 1.0 由维护者决定。
- 发布通过 `.github/workflows/release.yml` 手动触发，绑定需要审批的 `release` 环境，开启 npm provenance。**每次发布都要维护者批准**，agent 不能执行 `npm publish`，也不能打发布标签。
