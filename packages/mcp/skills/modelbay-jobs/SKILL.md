---
name: modelbay-jobs
description: 查已有 Modelbay 异步任务的进度、续接上次生成或补取已生成的文件时使用。
metadata:
  modelbay-entry-tools: get_job recover_job list_jobs
  modelbay-related-tools: get_tool_help
---

# 查询和恢复已有任务

1. 先找原任务的 `job_id` 或 `task_id`，并选用原平台的 MCP 连接。在[工具清单](references/tools.md)核对当前连接提供的查询工具。
2. 清单提供 `get_job` 时用它查询状态和结果，支持 `wait` 时可以短暂等待。任务还在运行就继续查同一个 ID。
3. 生成完成但要补取文件时，按清单使用 `recover_job`。若只有查询工具可用，查看它是否会重新交付文件。`list_jobs` 只列本进程的任务，服务重启后可用已记录的远程任务 ID 查询。
