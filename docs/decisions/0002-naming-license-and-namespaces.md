# 0002：命名、许可与命名空间

- 状态：已接受
- 日期：2026-11-04

## 背景

这个 SDK 有机会被外部项目引用，名字要好记、各平台上都没被占用，还要和 ikuyu 的开源总品牌对得上。

## 决策

- **总品牌是 ikuyu。** 域名用 `ikuyu.com`，npm 组织 `@ikuyu`，GitHub 组织 `ikuyu-labs`。`ikuyu-labs` 是 2026-11-04 由空组织 `aikuyu` 改名而来；`github.com/ikuyu` 被一个活跃的无关个人账户占用，不再争取。
- **产品名叫 Modelbay。** model 加 bay（港湾、泊位，也是录音棚里的跳线盘），意思是各家模型停靠在同一个港口，任何来源都能接到任何去处。
- 包名与仓库：

  | 角色   | 名字                                                                                                |
  | ------ | --------------------------------------------------------------------------------------------------- |
  | SDK    | `modelbay`，平台特有导出走 `modelbay/<平台>` 子路径                                                 |
  | 内部包 | `@modelbay/core`、`@modelbay/shared`、各平台包，不发布，见 [0005](0005-three-published-packages.md) |
  | MCP    | `@modelbay/mcp`，命令名 `modelbay-mcp <平台>`                                                       |
  | CLI    | `@modelbay/cli`，命令名 `modelbay`                                                                  |
  | 仓库   | `github.com/ikuyu-labs/modelbay`                                                                    |
  | 文档站 | `modelbay.ikuyu.com`                                                                                |

- **许可证用 MIT。**

## 理由

- 常见英文词几乎都被占了，比如 relay、prism、nexus、patchbay、conduit。2026-11-04 查询时，`modelbay` 在 npm 包名、npm 组织、GitHub、PyPI 上都是空的，也没搜到同名产品。
- 不用 `ai` 做名字：Vercel 的 `ai` 包很常用，`from 'ai'` 和 `from '@ikuyu/ai'` 放在一起容易混淆；`ai` 这个名字也过于宽泛，跟实际范围不符。
- 产品用自己的 npm scope，总品牌靠组织和署名体现，做法跟 Vercel 和 `@ai-sdk` 的关系一样。
- 用 MIT 不用 AGPL：任何许可的项目都能依赖 MIT 库；反过来，外部项目要是依赖 AGPL 代码就麻烦了。

## 代价与约束

- npm 组织 `@modelbay` 已建好（owner `uhoobnn`，免费套餐）。`modelbay` 包名还没占，按决定等有代码了再发第一版。这期间包名可能被别人抢注。
- `modelbay.com`、`modelbay.ai` 已被注册，`modelbay.dev` 还没被注册，以后需要的话再买。
- 公开推广之前，要查国内商标网和 USPTO 有没有同名商标。

## 未决事项

- GitHub 仓库 `ikuyu-labs/modelbay` 还没建。目前只有本地仓库，什么时候公开由维护者决定。
