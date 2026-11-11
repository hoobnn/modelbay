---
'modelbay': minor
---

MiniMax 新增图片模型 `MiniMax-H3-Image` 和 `MiniMax-H3-Image-Highspeed`：没有参考图时文生图，带 1–16 张参考图时图片编辑；支持画幅 + 1K/2K/4K 面积档或自定义宽高（最大 2000 万像素）、输出格式与压缩质量、关闭提示词增强。MCP `generate_image` 新增 `images`（多张参考图）和 `resolution` 参数。MiniMax 的 OpenAI 风格错误按 message 末尾的业务码归类（如 1026 归为内容安全）。
