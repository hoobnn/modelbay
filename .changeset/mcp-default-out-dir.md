---
'@modelbay/mcp': patch
---

新增环境变量 `MODELBAY_MCP_OUT_DIR`：调用没给 `out_dir` 时，文件结果落到 `<目录>/<平台>`，显式 `out_dir` 仍然优先。原生操作直接带回文件的（如豆包播客）也按同样规则落盘；原生异步任务返回的 `task_id` 登记进 `list_jobs`。
