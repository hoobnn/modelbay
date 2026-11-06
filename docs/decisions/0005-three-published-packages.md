# 0005：对外只发三个包，内部分包只做代码边界

- 状态：已接受
- 日期：2026-11-06

## 背景

仓库里有 10 个包：`@modelbay/core`、`@modelbay/shared`、5 个平台包、汇总入口 `modelbay`、`@modelbay/mcp`、`@modelbay/cli`。首发前它们都准备单独发布到 npm，但分开发布带来的好处这个项目用不上：

- 目标 G3 要求外部项目只装 `modelbay`，而 `modelbay` 依赖全部平台包，装它就等于全装。
- 平台包都是基于 `fetch` 的纯代码，构建出来每个只有 150–300KB，按需安装省不了多少。
- changesets 本来就让所有包共用一个版本号，分包并不能分开迭代。
- `@modelbay/shared` 是内部工具代码，一旦发布就成了别人能依赖的公开 API。
- 每个发布包都要单独维护元数据、README 和发布检查。包名发布后就是对外契约，以后再合并会影响已经装过的用户。

## 决策

1. **对外只发三个包。**

   | 包              | 内容                                                                                                   |
   | --------------- | ------------------------------------------------------------------------------------------------------ |
   | `modelbay`      | SDK。根入口提供 core 的全部 API、`createModelbay()` 和平台命名空间；`modelbay/node` 提供 Node 版适配器 |
   | `@modelbay/mcp` | MCP server，命令 `modelbay-mcp <平台>`，只依赖 `modelbay`                                              |
   | `@modelbay/cli` | 命令行，命令 `modelbay`，只依赖 `modelbay`                                                             |

2. **平台特有的导出走 `modelbay` 的子路径。** `modelbay/<平台>` 对应原来的 `@modelbay/<平台>`，`modelbay/<平台>/node` 对应原来的 `@modelbay/<平台>/node`。core 的 API 直接从 `modelbay` 导入。
3. **内部包保留，但标成 `private`。** `@modelbay/core`、`@modelbay/shared` 和 5 个平台包仍是独立的 workspace 包，用来守住分层边界：根入口只用各运行时都有的 API，平台包之间互不依赖（唯一例外：方舟依赖豆包语音）。
4. **`modelbay` 构建时把内部包打进产物**（`vite.package.ts` 的 `bundleWorkspace`）。内部包的第三方依赖改由 `modelbay` 声明：AI SDK 作为 `dependencies`，`ws`、`sharp`、`@volcengine/tos-sdk` 作为可选 peer。
5. **`@modelbay/mcp`、`@modelbay/cli` 的源码只从 `modelbay` 导入**，不直接导入内部包。整个依赖树里 core 只有一份，`ProviderError` 之类的 `instanceof` 判断才可靠。

## 理由

- 用户只记一个包名；单个平台的能力换一个子路径就能拿到，迁移时把 `@modelbay/xxx` 换成 `modelbay/xxx` 即可。
- 内部包不对外，重构 core、shared 和平台包时不用顾及兼容。
- 每次发布从 10 个包减到 3 个，发布检查、包元数据和 README 的维护量也随之减少。
- 分层边界继续由包边界和检查脚本守住，不靠自觉。

## 代价与约束

- 用户只用一个平台也要下载全部平台的代码（打包后约 800KB）。`sideEffects: false` 加上子路径导入，打包工具可以摇掉没用到的平台。
- `scripts/check-packages.mjs` 会检查发布包的依赖和产物里有没有引用 `private` 内部包，有就让 `pnpm verify` 失败。
- 新增平台时，除了平台包本身和注册表里的一行，还要在 `packages/modelbay` 加子路径入口和 `exports`，并把它的第三方依赖并到 `modelbay` 里，见 [扩展指南](../extending.md)。

## 未决事项

- 如果以后要让第三方自己写平台包，需要单独发布 `@modelbay/core`。那是新增一个包，不影响已有的三个。
