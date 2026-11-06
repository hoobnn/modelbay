---
'modelbay': patch
'@modelbay/mcp': patch
---

方舟补回 Responses API 的联网搜索（`web_search`）、续接响应（`previous_response_id`）与 `max_tool_calls`，以及多模态向量化 `embed`（MCP 工具 `embed`）。只对声明里支持的按量模型开放，套餐渠道直接拒绝。
