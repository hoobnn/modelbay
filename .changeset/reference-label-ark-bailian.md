---
'modelbay': patch
---

提示词里的参考素材引用改成各平台官方写法：方舟 Seedance 写「@图片N / @视频N / @音频N」，百炼万相 3.0 写「图N / 视频N / 音频N」（此前都被改写成 `@imageN`）。`ReferenceLabelStyle` 新增 `ark-video`、`bailian-video`，`videoReferencePrompt` 的平台参数新增 `bailian`；`referenceLabelStyle` 对方舟与百炼返回新写法。同时补全声明：z-image-turbo 每次 1 张、Seedance 2.5 的 `output_format`、MiniMax H3 的 `videoModes`（不开放仅尾帧）。
