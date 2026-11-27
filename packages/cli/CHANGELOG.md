# @modelbay/cli

## 0.6.1

### Patch Changes

- e5d5173: 方舟 `doubao-seedream-5-0-260128` 已过官方第十批下线说明的 EOS（2026-11-24 14:00），生命周期改为 `retired`。
- 8b0ed4f: 豆包语音新增 `doubao-seed-tts-3.0`（语音合成 3.0）：走独立的 `voice.cn-beijing.volces.com` 接口，只支持 API Key，文本最长 10000 字，附 10 个 3.0 通用音色。
- Updated dependencies [e5d5173]
- Updated dependencies [8b0ed4f]
  - modelbay@0.6.1

## 0.6.0

### Minor Changes

- 08efce3: 方舟新增图片模型 `doubao-seedream-4-0-260415`（别名 `doubao-seedream-4-0-20260415`，支持组图，最多 14 张参考图，分辨率档位 1K / 2K / 4K）和 Agent Plan 套餐模型 `glm-5.4`；`doubao-seedream-5-0-260128` 的下线日期与官方第十批下线说明对照后不变，仍是 2026-11-24。
- 436d662: 百炼新增 8 个对话模型：`deepseek-v4-pro`、`deepseek-v4.1-flash`、`kimi-k3`、`kimi-k3.1-pro`、`glm-5.3`、`MiniMax-M3.1-Flash`、`mimo-v2.6-pro-ultraspeed`、`stepfun/step-5-preview`；新增 MiniMax 语音合成 `speech-2.8-hd`、`speech-2.8-turbo`、`speech-02-hd`、`speech-02-turbo`（必须指定 voice，单次最多 9999 字符，不支持 instructions，返回音频本身而不是链接）。
- 52bbbae: 模型声明新增 `maxInputTokens`（官方把最大输入与上下文窗口分开公布时才填，渠道上可以单独覆盖），模型信息与 `list_declared_models` 都会带上；渠道新增 `protocol` 字段，用来区分同一接口路径下的不同请求体形态。方舟 14 个模型、OpenAI GPT-6 / 6.1 / 6.2 系列补上最大输入，方舟 `kimi-k3` 标为即将下线。DeepSeek 思考强度支持官方列出的七种请求值，思考开启时不再发送官方不采纳的 `temperature`（显式关闭思考后照常透传）。

### Patch Changes

- 53634df: 更新未显式指定模型时使用的默认值。OpenAI 对话和图像分别改用 GPT-6.2 Astra 和 GPT-Image-2.6 Sunburst，方舟按量与套餐的图像生成和处理改用 Seedream 5.5，百炼按量对话改用 Qwen4-Max，套餐对话继续使用 Qwen3.8-Max，MiniMax 对话和图像分别改用 M3.1 Flash 和 H3 Image。显式传入的模型 ID 仍按原声明解析。
- Updated dependencies [318d726]
- Updated dependencies [08efce3]
- Updated dependencies [436d662]
- Updated dependencies [3100ebf]
- Updated dependencies [53634df]
- Updated dependencies [52bbbae]
- Updated dependencies [ef02c1a]
- Updated dependencies [53634df]
- Updated dependencies [e38a0c9]
  - modelbay@0.6.0

## 0.5.1

### Patch Changes

- 83f3a09: 接入 DeepSeek 官方模型及对话、搜索、网页读取、文件解析、OCR 和语音服务，并加入 SDK、MCP、CLI 平台注册及上游文档对账。
- 28b34d6: 接入火山方舟 Seedream 5.5，支持原生 RGBA 图片生成、最多 99 个图层拆分及富文本 OCR 元数据，修正默认 PNG 输出识别，并同步 SDK、MCP 和 CLI 模型目录。
- Updated dependencies [83f3a09]
- Updated dependencies [28b34d6]
  - modelbay@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [ef5e661]
- Updated dependencies [4fa3d4b]
- Updated dependencies [ef5e661]
  - modelbay@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [93440cd]
- Updated dependencies [8d90620]
- Updated dependencies [6cf4aa3]
- Updated dependencies [fb7322b]
  - modelbay@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [1715702]
  - modelbay@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [2975cfe]
  - modelbay@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [8228dd7]
  - modelbay@0.2.1

## 0.2.0

### Patch Changes

- 9a9587c: npm 包补充关键词在前的描述与 keywords，README 里指向仓库根目录与文档的相对链接改为绝对地址，npm 页面上不再失效。
- Updated dependencies [84b5bee]
- Updated dependencies [89e1df7]
- Updated dependencies [9a9587c]
  - modelbay@0.2.0

## 0.1.3

### Patch Changes

- b6dff9c: `doctor` 分开列出已配置和未配置的密钥名（`DoctorEntry.present`），不再把任选一组的所有名字列在一起，看起来像全都配好了。
- Updated dependencies [816fe0e]
- Updated dependencies [de41805]
- Updated dependencies [b6dff9c]
- Updated dependencies [de41805]
- Updated dependencies [039c35a]
  - modelbay@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [9e7b2f8]
  - modelbay@0.1.2

## 0.1.1

### Patch Changes

- Publish through npm trusted publishing (OIDC), so every package now carries npm provenance. No code changes from 0.1.0.
- Updated dependencies
  - modelbay@0.1.1
