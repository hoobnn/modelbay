---
'modelbay': minor
---

百炼新增模型：HappyHorse 1.1 文生视频 / 图生视频 / 参考生视频（`happyhorse-1.1-t2v` / `-i2v` / `-r2v`，3–15 秒，参考生视频的提示词编号写成 `[Image N]`）、`wan2.7-image`（最高 2K）、`qwen3.7-text-embedding`（最高 2560 维）、`qwen3.7-text-embedding-flash`、`qwen3-vl-rerank`（目前只收文本）。

百炼视频生成的时长范围、参考素材数量、画幅、是否发送音频开关改为按模型声明校验；`referenceLabelStyle` 新增可选的 `model` 参数和 `happyhorse-video` 写法。
