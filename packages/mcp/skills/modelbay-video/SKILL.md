---
name: modelbay-video
description: 用 Modelbay 从文本、首尾帧或多种参考素材生成视频，并跟进生成和文件交付时使用。
metadata:
  modelbay-entry-tools: generate_video animate_portrait
  modelbay-related-tools: create_h3_context_ir_task upload_file list_declared_models get_tool_help get_job recover_job list_jobs
---

# 生成视频

1. 打开[工具清单](references/tools.md)，按任务选择视频工具。先确认输入是文本、指定帧还是参考素材，再从工具说明核对所选模型支持的组合、素材形式和参数范围。
2. 工具接受提示词时，把用户想要的主体、动作、镜头和声音写进去。按 schema 填入素材、时长、分辨率和比例。素材需要先上传时，使用清单提供的上传工具和它返回的引用。用户需要保存文件且工具支持时，指定输出目录。
3. 提交后保存原平台与 `job_id` 或 `task_id`。若任务仍在运行，用清单里的 `get_job` 查同一个 ID。工具支持 `wait` 时，可以在调用内等候进度变化。
4. 按结果状态交付文件或链接。生成已完成但文件需要补取时，用清单里的 `recover_job` 查原任务。
