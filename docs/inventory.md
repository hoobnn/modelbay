# 现有实现盘点（2026-11-04）

> 盘点对象：`hoobnn-mcps`（Python，4 个 MCP server）和 `plein/packages/providers`（TypeScript）。迁移完成后本文作废。
> 原始数据在 [`inventory/`](inventory/)：`plein-models.json` 是 plein 全部 provider 的 `ModelSpec`，从源码运行时导出；`mcp-*.json` 是四个 MCP 打开全部工具组后的工具 schema。

## 规模

- plein：6 个平台（方舟按量、方舟套餐、百炼、MiniMax、豆包语音、OpenAI），外加 OpenAI 兼容渠道和 mock，共 76 个静态模型声明（不含 mock）。
- MCP：方舟 9 个工具、百炼 19 个、豆包语音 24 个、MiniMax 18 个，共 70 个。其中豆包的实时会话和管理工具、MiniMax 的删除任务工具需要手动启用。

## 一、平台 × 能力矩阵

P 表示 plein 有，M 表示 MCP 有，— 表示都没有。

| 能力 | 方舟 | 百炼 | MiniMax | 豆包语音 | OpenAI |
|---|---|---|---|---|---|
| 对话 `text.chat` | P M | P M | P | — | P |
| 生图 `image.generate` | P M | P M | P M | — | P |
| 蒙版重绘 `image.edit` | — | P | — | — | P |
| 放大 / 扩图 / 抠图 `image.process` | P（抠图） | P | — | — | — |
| 生视频 `video.generate` | P M | P M | P M | — | — |
| 视频编辑 / 2K 再生成 | — | M | M | — | — |
| 数字人对口型 | — | M | — | — | — |
| 视频提示词增强（H3 Context IR） | — | — | M | — | — |
| 配音 `audio.speech` | P（套餐） | P M | P M | P M | — |
| 配乐 `audio.music` | — | — | P M | P M | — |
| 音效 `audio.sfx` | — | — | — | P M | — |
| 识别 `audio.transcribe` | P（套餐） | M | — | P M | — |
| 音色复刻 / 设计 / 查询 | — | M | M | M（另有升级） | — |
| 向量 | M | M | — | — | — |
| 重排序 | — | M | — | — | — |
| 播客 / 同传 / 翻译 / 妙记 / 实时对话 | — | — | — | M | — |
| 控制台 / 词表 / 原始请求兜底 | — | — | M（删任务） | M | — |
| 异步任务查询与恢复 | 两边都有，各自实现 | | | | |

## 二、逐平台模型对照

### 火山方舟

- 两边都有：Seedream 5.0 Pro / Flash；Seedance 2.5、2.0、2.0 Fast、2.0 Mini。
- 对话模型：plein 固定 5 个 Seed 2.1 / Evolving 型号，另可填自定义 ID。MCP 用简称 `pro`（指向 `doubao-seed-2-1-pro-260915`），也接受完整 ID。
- 只有 plein 有：方舟套餐（`arkPlanProvider`）27 个模型，包括 DeepSeek、GLM、Kimi 等第三方对话模型，以及套餐里的 TTS 2.0 和 ASR 2.0。
- 只有 MCP 有：向量。

### 阿里云百炼

- 两边都有：qwen3.8-max、qwen3.7-plus、qwen3.8-flash，qwen-image-3.0-pro，wan2.7-image-pro，wan3.0-video / prime。
- 配音：plein 只有 `qwen3-tts-flash`。MCP 原来默认也用它（0.8.0 起改为 `qwen-audio-3.1-tts-flash`），另外还支持 qwen-audio 3.0 / 3.1 的 flash 和 plus，以及 CosyVoice v2 到 v3.5。
- 只有 plein 有：qwen-image-3.0（非 pro）、`wanx2.1-imageedit`（蒙版重绘和精修）。
- 只有 MCP 有：z-image-turbo、qwen3-asr-flash、happyhorse 视频编辑、wan2.2-s2v 数字人、text-embedding-v4、qwen3.7-text-rerank、音色复刻和设计、官方模型目录查询。

### MiniMax

- 两边都有：H3 / H3-Highspeed / H3-Lite / H3-Max，image-01 / image-01-live，speech-2.8-hd / turbo。
- 只有 plein 有：对话模型 M3、M3.1-Flash、M2.7。
- 只有 MCP 有：music-2.6、歌词、音色复刻和设计、音色列表、2K 再生成、Context IR、文件上传、云端任务列表和删除。

### 豆包语音

- 两边都有：seed-tts-2.0、seed-audio-1.0、录音文件识别极速版（`volc.bigasr.auc_turbo`）。
- 只有 plein 有：seed-icl 1.0 / 2.0，作为「已有音色」型号使用。
- 只有 MCP 有：seed-tts-1.0、长文本异步合成、识别标准版和闲时版、播客、同传 2.0、Seed-X 翻译、妙记、复刻 / 设计 / 升级音色、实时对话 3.0、控制台 OpenAPI、热词表、原始请求兜底。

### 只在 plein

OpenAI（gpt-6.1-sol、gpt-6-astra、gpt-6.1-terra、gpt-6-luna，以及 gpt-image-2.5-sunburst / flare）、OpenAI 兼容渠道、mock。

## 三、模型状态核对

2026-11-04 读取官方原文核对，并对照两边代码和文档复查。最初盘点时看到的三处「冲突」，复查后只有一处是真正的分歧，其余两处是盘点本身看漏了。

| 项目 | 官方原文 | plein | MCP | 状态 / 处理 |
|---|---|---|---|---|
| MiniMax `music-3.0` | 自 2026-08-20 起付费接口不再向新用户开放，历史付费用户可继续使用；`*-free` 停止服务。`music-3.0` 仍是推荐型号 | 行为正确（`deprecated: true`，不当默认，但还能运行）；说明写成了「官方已退役」，不准确。**已改正** | 工具描述已写明这条公告，无需改动 | `closed-to-new-accounts` |
| Seedream 5.0 Lite（`doubao-seedream-5-0-260128` / `-lite-260128`） | [下线公告](https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh)：停止新购，2026-11-24 14:00（UTC+8）关停；模型列表标「即将下线」 | 已标注日期，不当默认 | 有生命周期提示，到期后本地拒绝 | **不是冲突**，两边一致。状态为 `sunsetting`，日期 2026-11-24 |
| 百炼 TTS 默认模型 | 官方推荐 `qwen-audio-3.1-tts-flash`（低延迟）和 `-plus`（音质）；`qwen3-tts-flash` 仍作为独立系列列出 | 默认 `qwen3-tts-flash`，而且不支持 Qwen-Audio-TTS 系列 | 原来默认也是 `qwen3-tts-flash`（复刻 / 设计的默认目标是 3.0-flash）。**已在 0.8.0 改为 3.1-flash**，兼容旧的 qwen3 音色调用 | 3.1-flash 设为 `active` 并作为默认；3.0-flash 记为 `superseded`；qwen3-tts-flash 保持 `active` 但不当默认。plein 缺的 Qwen-Audio-TTS 支持随迁移第 3 步补上 |

来源：

- [MiniMax 音乐生成接口](https://platform.minimax.cn/docs/api-reference/music-generation)
- [火山方舟模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)
- [百炼语音合成模型](https://help.aliyun.com/zh/model-studio/tts-model)

另外：百炼的 TTS 模型列表里也有 `MiniMax/speech-2.8-hd` 等 MiniMax 型号。这是同一个模型经由两个渠道提供的实例，[0003](decisions/0003-capabilities-and-model-declarations.md) 中「模型身份和渠道分开」那一条就是因此而来。
