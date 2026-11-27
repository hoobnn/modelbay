---
name: modelbay-image
description: 用 Modelbay 生成图片、按参考图重绘或编辑用户已有的图片时使用。
metadata:
  modelbay-entry-tools: generate_image
  modelbay-related-tools: h3_image_context_ir list_declared_models get_tool_help get_job recover_job
---

# 生成和编辑图片

1. 在[工具清单](references/tools.md)选出图像工具。先判断任务是生成新图、按参考图重绘，还是只编辑现有图的某个区域。
2. 写清画面、文字、构图和保留要求。按工具说明检查参考图、遮罩、宽高比与尺寸字段，再选择支持所需输入的模型。清单有 `get_tool_help` 时可查模型相关限制。
3. 用户需要文件且工具提供 `out_dir` 或 `output_directory` 时，指定输出目录。按实际返回交付文件路径、链接或 MCP 图像内容。
4. 如果只返回任务 ID，使用清单里的任务查询工具跟进。继续修改时，用已交付的图作为下一轮参考。
