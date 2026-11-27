---
name: modelbay-audio
description: 用 Modelbay 合成配音、旁白或多角色语音，以及生成播客、音乐和其他音频时使用。
metadata:
  modelbay-entry-tools: text_to_speech synthesize_speech generate_audio generate_podcast music_generation
  modelbay-related-tools: list_voices get_voice get_tool_help list_declared_models
---

# 生成音频

1. 查[工具清单](references/tools.md)，根据任务选择配音、播客或音乐工具。给定逐字稿时用语音合成工具。需要根据自然语言编排多角色语音或音乐时，查目标生成工具的用法。
2. 对照 schema 提供原文或提示词。指定音色时，核对所选平台和模型接受的音色 ID 或参考音频形态。工具有音色目录时可以先查询。
3. 用户指定格式或输出目录时，使用工具提供的字段。结果可能返回本地路径、链接或 MCP 音频内容，按实际结果交付。
