---
'@modelbay/mcp': patch
---

新增环境变量 `MODELBAY_MCP_OUT_DIR`：调用没给 `out_dir` 时，文件结果落到 `<目录>/<平台>`，显式 `out_dir` 仍然优先。
