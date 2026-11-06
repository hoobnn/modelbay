---
'modelbay': patch
'@modelbay/mcp': patch
---

方舟 MCP 支持套餐渠道：`ark-plan:` 前缀的模型走 Agent Plan（`ARK_AGENT_PLAN_API_KEY`），只配套餐 key 时默认走套餐；原来所有调用都按量计费，`ark-plan:` 模型也会用 `ARK_API_KEY` 发出。`PlatformDescriptor` 新增可选的 `channelSecrets`。
