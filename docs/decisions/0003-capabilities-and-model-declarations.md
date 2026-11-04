# 0003：能力划分与模型声明格式

- 状态：提议
- 日期：2026-11-04

## 背景

[盘点](../inventory.md)显示：plein 定义了 9 种能力，MCP 那边多出约 15 类。现有的 `deprecated: true` 只能表达「退役 / 没退役」，表达不了官方实际给出的那些状态。

## 决策

### 能力划分

- **两家及以上平台都有的能力**，做成归一化能力，有统一的输入输出类型：
  - 沿用 plein 现有的 9 种：`text.chat`、`image.generate`、`image.edit`、`image.process`、`video.generate`、`audio.speech`、`audio.music`、`audio.sfx`、`audio.transcribe`
  - 新增：`voice.clone`、`voice.design`、`voice.list`（三家都有），`text.embed`（两家）
- **只有一家有的能力**，走 `native(op, params)`，参数 schema 由适配器自己声明。MCP 照样能为它生成工具，plein 不做通用节点。目前属于这一类的有：重排序、数字人对口型、H3 Context IR、2K 再生成、播客、同传、翻译、妙记、控制台管理、热词表、原始请求兜底。第二家平台也支持后，再升级成归一化能力。
- **视频编辑**暂时放进 `native`。百炼的指令编辑和 MiniMax 的 2K 再生成语义不同，不合并。
- **实时对话**单独定义 `session` 接口（open / send / receive / close），按需实现，不套进 submit / poll 模型。

### 模型声明格式

每个模型一个纯数据文件，写成 TS 并 `satisfies ModelSpec`，不允许写逻辑，构建时导出 JSON。在 plein 现有 `ModelSpec` / `ModelLimits` / `MediaRequirements` 的基础上，加以下几项：

1. **模型身份和渠道分开。** 规范 ID 用 `厂商/模型`，比如 `minimax/speech-2.8-hd`。每个渠道单独写一条：渠道内的 ID、接口地址，以及需要覆盖的上限。比如同一个模型，在 MiniMax 渠道里叫 `speech-2.8-hd`，在百炼渠道里叫 `MiniMax/speech-2.8-hd`；Seedream 在方舟按量和方舟套餐两个渠道下也各有一条。消费方用 `渠道:渠道内ID` 选模型，规范 ID 用来去重和对比。
2. **别名**分两种：
   - 官方别名：同一个模型的多个官方 ID，比如 `doubao-seedream-5-0-260128` 和 `doubao-seedream-5-0-lite-260128`。
   - 简称：比如 `pro`、`flash`、`wan`，这是 MCP 一直在用的写法。
3. **生命周期**是一个枚举，每个状态都带官方来源链接和核对日期：

   | 状态 | 含义 | 能选吗 | 能当默认吗 |
   | --- | --- | --- | --- |
   | `active` | 正常 | 能 | 能 |
   | `superseded` | 能用，但官方已有更推荐的型号（记下 `by`） | 能，会提示有更新的型号 | 不能 |
   | `sunsetting` | 官方标了即将下线（有日期就记，没有就留空） | 能，会给提示 | 不能 |
   | `closed-to-new-accounts` | 老用户还能用，新用户开不了（记下 `since`） | 能，会提示账号限制 | 不能 |
   | `retired` | 已下线 | 不能；旧画布引用能打开，但不能运行 | 不能 |

4. **自定义 ID 透传。** 用户填写的、不在声明里的模型 ID（plein 的 `custom-*`、MCP 里传的完整 ID），用宽松模式校验：只检查和能力相关的通用约束。
5. **来源。** 每个模型记下它依据的官方文档页，上游文档监控按这个对应关系，把变化定位到具体的声明。

## 理由

- 2026-11-04 核对的三个模型，分别需要 `closed-to-new-accounts`、`sunsetting`、`superseded` 三种不同的状态。原来的 `deprecated: true` 表达不了：plein 只能把仍对老用户可用的 `music-3.0` 写成「已退役」，即将下线的日期也只能塞进说明文字。
- 百炼也转售 MiniMax 的语音模型。没有「模型身份和渠道分开」这一层，同一个模型就只能复制两份声明。

## 代价与约束

- 迁移第 2 步的抽取脚本，要把 plein 现有的 `deprecated: true` 逐个对照官方原文，映射到新的生命周期状态，不能一律映射成 `retired`。
- 选择默认模型的逻辑由核心统一实现：不在 `active` 状态的模型不能当默认。消费方不得自行绕过这一条。
