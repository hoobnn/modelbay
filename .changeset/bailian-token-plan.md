---
'modelbay': minor
'@modelbay/mcp': minor
---

百炼新增 Token Plan 渠道（`bailian-plan`，密钥 `BAILIAN_TOKEN_PLAN_API_KEY`，只接文本对话），接入仅限套餐的 `qwen4-max-preview`（别名 `qwen4.0-max-preview`，2026-11-25 预览结束下线），并给 qwen3.8-max / qwen3.8-flash / qwen3.7-plus 补上套餐渠道。套餐模型标为 agentOnly。

百炼对话有工具调用时，思考内容通过 `continuation.reasoningContent` 返回，下一轮同模型自动按 `reasoning_content` 回传。
