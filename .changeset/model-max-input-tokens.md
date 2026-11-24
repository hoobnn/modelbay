---
'modelbay': minor
'@modelbay/mcp': minor
'@modelbay/cli': minor
---

模型声明新增 `maxInputTokens`（官方把最大输入与上下文窗口分开公布时才填，渠道上可以单独覆盖），模型信息与 `list_declared_models` 都会带上；渠道新增 `protocol` 字段，用来区分同一接口路径下的不同请求体形态。方舟 14 个模型、OpenAI GPT-6 / 6.1 / 6.2 系列补上最大输入，方舟 `kimi-k3` 标为即将下线。DeepSeek 思考强度支持官方列出的七种请求值，思考开启时不再发送官方不采纳的 `temperature`（显式关闭思考后照常透传）。
