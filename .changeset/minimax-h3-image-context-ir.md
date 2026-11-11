---
'modelbay': minor
---

MiniMax 新增原生操作 `image-context-ir`（MCP 工具 `h3_image_context_ir`）：单独调用 `MiniMax-H3-Image` 的 Prompt 增强，同步返回增强后的 prompt，不生成图片；可带 1–16 张参考图按图片编辑增强。只有声明里标了 `native: ['image-context-ir']` 的模型可用，Highspeed 不支持。
