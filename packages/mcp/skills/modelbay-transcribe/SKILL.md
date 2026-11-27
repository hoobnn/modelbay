---
name: modelbay-transcribe
description: 用 Modelbay 转写音频文件、识别语音内容、整理会议纪要或处理同声传译时使用。
metadata:
  modelbay-entry-tools: speech_to_text transcribe_speech transcribe_file summarize_meeting interpret_audio
  modelbay-related-tools: translate_text get_speech_usage_examples get_tool_help list_declared_models
---

# 转写和理解语音

1. 打开[工具清单](references/tools.md)。按所需产物选择转写、会议纪要或同声传译工具。
2. 读取工具 schema，确认接受的是本地路径、可访问的音频 URL，还是编码后的文件内容。从工具说明核对格式、语言、说话人和时间戳等选项。
3. 提交音频并按返回内容交付原文、分段时间、译文或纪要。工具返回远程任务 ID 时，记录 ID 并按工具说明使用查询入口。
