---
'modelbay': patch
'@modelbay/mcp': patch
---

豆包语音：播客返回音频文件输出（优先用平台给的音频 URL，否则拼接流式音频）；TTS 与 Seed Audio 的采样率写进模型声明（`limits.sampleRates`），校验和 MCP schema 都从声明派生；播客按官方文档单独校验。core 新增 `sampleRates` 上限与 `sampleRate` 参数种类。
