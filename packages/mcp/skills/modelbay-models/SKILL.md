---
name: modelbay-models
description: 查找 Modelbay 模型、核对模型的渠道与生命周期，或选择模型进行对话、文档识别、向量化和重排时使用。
metadata:
  modelbay-entry-tools: list_declared_models
  modelbay-related-tools: chat embed rerank recognize_document create_response create_message create_chat_completion complete_fim list_models list_remote_models list_capabilities list_speech_capabilities get_tool_help
---

# 选择模型

1. 打开[工具清单](references/tools.md)，确认当前连接提供的工具。用 `list_declared_models` 查本地声明，需要缩小范围时传任务对应的 `capability`。
2. 查看候选模型的 `status`、`notice` 和 `channels`。选当前可用的渠道和该渠道的模型 ID，再对照目标工具的 `model` 字段。工具提供合适的默认值时，可以省略 `model`。
3. 按任务选择对话、识别文档、向量化或重排工具。以目标工具的 schema 组织输入，具体的平台选项可用清单中的 `get_tool_help` 查询，传入 `tool` 指定工具名。
4. 用户需要确认平台账户的实时模型目录时，使用清单里的远程目录工具。模型声明反映 Modelbay 登记的能力，账户实际可用性由平台决定。
