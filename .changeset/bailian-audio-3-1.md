---
'modelbay': minor
'@modelbay/mcp': minor
---

百炼接入 Qwen-Audio 3.1 语音模型并支持多模态重排序：

- `qwen-audio-3.1-asr-flash`：同步识别走 DashScope 原生接口，返回带时间戳的句子；`speech_to_text` 可直接选用。
- `qwen-audio-3.1-asr-flash-filetrans`：录音文件转写（最长 12 小时），新增 native 操作 `asr-filetrans` 与 MCP 工具 `transcribe_file`，`get_job` 返回全文和以秒为单位的句子。
- `qwen-audio-3.1-tts-next`：音频生成，新增 native 操作 `audio-generation` 与 MCP 工具 `generate_audio`，提示词里可用 `@voice1`–`@voice3` 引用最多 3 段参考音频。
- `rerank` 的 query / documents 支持 `{text|image|video}` 对象，配合 `qwen3-vl-rerank` 做图文视频重排；新增 `instruct`、`fps`。
- MCP 通用能力工具的模型清单不再列出只能走专用工具的模型（重排序、视频编辑、文件转写、音频生成）。
