---
'modelbay': minor
---

模型声明新增可选字段 `contextWindow`（一次请求输入加输出的总 token 数）和 `maxOutputTokens`（单次最多输出的 token 数），`ChannelRef` 可按渠道覆盖，`ModelInfo` 与 MCP `list_declared_models` 会带出。方舟、百炼、OpenAI、MiniMax 的对话模型已按官方文档补全数值；官方没有公布的模型不填。
