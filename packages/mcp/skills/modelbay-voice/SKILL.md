---
name: modelbay-voice
description: 在 Modelbay 查询音色、用录音复刻音色、按描述设计音色，或为后续配音准备音色 ID 时使用。
metadata:
  modelbay-entry-tools: clone_voice design_voice list_voices get_voice
  modelbay-related-tools: upload_file text_to_speech get_tool_help list_declared_models
---

# 查询、复刻和设计音色

1. 打开[工具清单](references/tools.md)。查询预置或已有音色时，选择列出音色或按 ID 查询的工具。
2. 复刻和设计分别使用清单里对应的工具。复刻用目标工具支持的音频输入，设计用语言、说话风格等要求。查看工具说明中的样本要求和返回字段。
3. 记录返回的音色 ID、关联平台及模型。后续配音时，对照语音合成工具的 schema 使用这组信息。
