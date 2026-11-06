---
'modelbay': patch
'@modelbay/mcp': patch
---

MiniMax：`design_voice` 的 `voice_id` 改为可选（不传时平台自动生成）；2K 重渲染两种模式都发送 `resolution`；`file_id` 按官方 int64 整数发送，超过 2^53 的值不丢精度；`context-ir` 与 2K 重渲染返回 `job_id` / `task_id`（原来是驼峰的 `taskId`）。
