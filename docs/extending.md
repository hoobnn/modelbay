# 扩展指南

新增模型、平台、能力或 MCP 工具时照这里的清单做。每一项做完都跑 `pnpm verify`。

## 新增或修改一个模型

1. 在 `packages/<平台>/src/models/` 下新建 `<模型>.ts`，写成 `export default { ... } satisfies ModelDeclaration`。只写数据，不写函数、条件分支或计算出来的值。格式见 [0003](decisions/0003-capabilities-and-model-declarations.md)。
2. 在同目录的 `index.ts` 里导入它，并放进 `all` 数组。数组顺序就是模型清单和 MCP 说明里的展示顺序。
3. 填 `source`、`lifecycle.source`，以及各渠道的 `source`（有的话）：都要是官方文档的 https 链接，再加实际读原文的日期 `YYYY-MM-DD`。域名要在 `scripts/upstream/sources.ts` 的 `OFFICIAL_HOST_SUFFIXES` 白名单里，新平台的文档站要先加进去。
   对话模型还要填 `contextWindow` / `maxOutputTokens`（官方公布了才填），在字段上方的注释里写官方页面链接、原文用词和核对日期，换算规则见 0003。
4. 不用写测试：`packages/modelbay/test/declarations.test.ts` 会自动检查所有声明，包括有没有登记进 `all`、是否纯数据、来源和日期、生命周期、默认冲突、别名冲突、`optionsSchema`。只有改了请求构造或路由时，才在平台包的 `test/` 里补夹具测试。

模型下线、改名或换默认，都只改声明，不改代码。

## 新增一个平台

平台包自描述，消费方（汇总入口、MCP、CLI）都只遍历注册表，所以新平台只动它自己的包和注册表。

1. 照现有平台建 `packages/<平台>/`：`package.json`（`exports` 有 `"."`，有 Node 扩展再加 `"./node"`）、`tsconfig.json`、`tsconfig.build.json`、三行的 `vite.config.ts`（`definePackageConfig(import.meta.url)`）、`README.md`。
2. 写适配器：`src/` 下按需拆成鉴权、请求、响应映射、错误映射，失败一律抛 `ProviderError`。根入口只能用各运行时都有的 API（`fetch`、`Uint8Array`、`crypto.subtle`……）。
3. 写声明：`src/models/*.ts` 加 `src/models/index.ts`，根入口导出 `models`。
4. 写 `src/platform.ts`，用 `definePlatform()` 导出描述对象，并从 `src/index.ts` 再导出：
   - `key`：包名后缀，也是 MCP 命令的参数；
   - `secrets`：必填密钥（外层任选一组，内层同组要配齐）、可选配置、别名；
   - `createAdapters(options)`：返回本平台的全部适配器；
   - `mcp.tools`（可选）：有它就自动有 `modelbay-mcp <key>`。
5. 有 Node 专属能力（文件 I/O、`sharp`、对象存储 SDK、WebSocket）的，放进 `src/node/`，从 `src/node/index.ts` 导出 `nodeOptions`。这些依赖写成可选 peer 依赖，在实现里惰性导入。
6. 在 `packages/modelbay` 里登记：
   - `src/platforms.ts` 的 `PLATFORMS` 加一行；
   - `src/index.ts` 加命名空间再导出；
   - `src/platform/<平台>.ts`（有 Node 扩展的再加 `<平台>-node.ts`）一行再导出，在 `vite.config.ts` 的 `entries` 和 `package.json` 的 `exports` 里登记 `./<平台>`（和 `./<平台>/node`）；
   - `package.json` 的 `devDependencies` 加 `"@modelbay/<平台>": "workspace:*"`，平台包的第三方依赖并到 `modelbay` 的 `dependencies` / 可选 peer；
   - 有 Node 扩展的，在 `src/node.ts` 的 `NODE_LOADERS` 加一行。
   - 平台包本身的 `package.json` 标 `"private": true`，不单独发布。
7. 在 `scripts/upstream/sources.ts` 的 `SOURCES` 里登记模型列表页和下线公告页，并在 `.github/workflows/upstream-docs.yml` 的平台列表里加上 `key`，见 [上游文档对账](upstream.md#新增平台或页面)。
8. `pnpm install`，然后 `pnpm verify`。打包入口、测试别名、TS 路径、覆盖率门槛（80%）都按目录约定自动生效，不用改。

平台包之间不互相依赖，公共的 HTTP、对话、尺寸换算放进 `@modelbay/shared`。目前唯一的例外是方舟依赖豆包语音（套餐渠道复用豆包语音的合成协议）。

## 新增一个归一化能力

只有一家平台有的能力先走 `native`，第二家也支持了再升级成归一化能力（见 0003）。

1. 在 `packages/core/src/capabilities.ts` 的 `ADDITIONAL_CAPABILITIES` 里加名字，并在 core 里定义它的输入输出类型。
2. 需要按模型校验的上限，加进 `ModelLimits` / `MediaRequirements`，并在 `deriveModelParam()` 里翻译成 JSON Schema。
3. 各平台适配器在 `submit` 里实现它，声明的 `capabilities` 里加上它。
4. 如果 MCP 里已有通用工具名对应这个能力，在 `packages/mcp/src/tool-meta.ts` 的 `TOOL_CAPABILITY` 里加映射；否则在平台的工具定义里写 `capability`。

## 新增一个 native 操作

1. 操作名加进 `packages/core/src/capabilities.ts` 的 `NATIVE_OPERATIONS`，名字用短横线小写。
2. 适配器实现 `native(op, params, ctx)`，并把 op 列进 `nativeOperations`。只有 Node 能跑的，实现放进 `src/node/`、通过 `nodeOptions` 注入，并把 op 列进适配器的 `nodeOnly`。
3. 需要 MCP 工具时，见下一节。

## 新增一个 MCP 工具

1. 在 `packages/<平台>/src/mcp/tools.ts` 里加一条 `ToolSpec`：`name`、`description`、`inputSchema`。只写平台特有的字段，不写模型 ID、上下限、默认值或生命周期，这些由声明派生。
2. 告诉生成器怎么路由：
   - 归一化能力：写 `capability`，随模型变化的参数写进 `modelParams`；
   - 平台独有操作：写 `native: '<op>'`；
   - 只读查询写 `nature: 'query'`，破坏性操作写 `nature: 'mutate'`；
   - 默认不该暴露的（管理、实时、需要本地文件）写 `group`。
3. 跨平台通用的工具名（`chat`、`generate_image`、`get_job`……）不用写这些字段，`packages/mcp/src/tool-meta.ts` 会按名字推断。新的通用约定才改那个文件。
4. `inputSchema` 里的每个参数都要真的生效。通用换算（见 [MCP 工具生成](mcp.md)）覆盖不到的，写 `mapArguments` 换成适配器读的字段或 native 参数；做不到就不要写进目录。在 `packages/mcp/test/real-<平台>.test.ts` 里用真实适配器加注入 fetch 断言请求体。

完整规则见 [MCP 工具生成](mcp.md)。
