# modelbay

## 0.5.1

### Patch Changes

- 83f3a09: 接入 DeepSeek 官方模型及对话、搜索、网页读取、文件解析、OCR 和语音服务，并加入 SDK、MCP、CLI 平台注册及上游文档对账。
- 28b34d6: 接入火山方舟 Seedream 5.5，支持原生 RGBA 图片生成、最多 99 个图层拆分及富文本 OCR 元数据，修正默认 PNG 输出识别，并同步 SDK、MCP 和 CLI 模型目录。

## 0.5.0

### Minor Changes

- ef5e661: 方舟的 DeepSeek / GLM / Kimi 第三方文本模型开放按量渠道：deepseek-v4.1-flash（`deepseek-v4-1-flash-261017`）、deepseek-v4.1-flash-economy、deepseek-v4-flash（`deepseek-v4-flash-ga-260731`）、deepseek-v4-pro（`deepseek-v4-pro-ga-260813`）、glm-5.3-flash（`glm-5-3-flash-260828`）、kimi-k3.1-pro（`kimi-k3-1-pro-261024`）。`agentOnly` 只标在套餐渠道上，按量渠道是普通对话模型。
- 4fa3d4b: 百炼接入 Qwen-Audio 3.1 语音模型并支持多模态重排序：

  - `qwen-audio-3.1-asr-flash`：同步识别走 DashScope 原生接口，返回带时间戳的句子；`speech_to_text` 可直接选用。
  - `qwen-audio-3.1-asr-flash-filetrans`：录音文件转写（最长 12 小时），新增 native 操作 `asr-filetrans` 与 MCP 工具 `transcribe_file`，`get_job` 返回全文和以秒为单位的句子。
  - `qwen-audio-3.1-tts-next`：音频生成，新增 native 操作 `audio-generation` 与 MCP 工具 `generate_audio`，提示词里可用 `@voice1`–`@voice3` 引用最多 3 段参考音频。
  - `rerank` 的 query / documents 支持 `{text|image|video}` 对象，配合 `qwen3-vl-rerank` 做图文视频重排；新增 `instruct`，`qwen3-vl-rerank` 另有 `fps`。
  - MCP 原生操作工具（`rerank`、`embed`、`edit_video`、`speech_to_text`、MiniMax `h3_image_context_ir` 等）的模型清单只列能用的模型；通用能力工具不变。

- ef5e661: 百炼新增模型：HappyHorse 1.1 文生视频 / 图生视频 / 参考生视频（`happyhorse-1.1-t2v` / `-i2v` / `-r2v`，3–15 秒，参考生视频的提示词编号写成 `[Image N]`）、`wan2.7-image`（最高 2K）、`qwen3.7-text-embedding`（最高 2560 维）、`qwen3.7-text-embedding-flash`、`qwen3-vl-rerank`。

  百炼视频生成的时长范围、参考素材数量、画幅、是否发送音频开关改为按模型声明校验；`referenceLabelStyle` 新增可选的 `model` 参数和 `happyhorse-video` 写法。

## 0.4.0

### Minor Changes

- 93440cd: 百炼新增 Token Plan 渠道（`bailian-plan`，密钥 `BAILIAN_TOKEN_PLAN_API_KEY`，只接文本对话），接入仅限套餐的 `qwen4-max-preview`（别名 `qwen4.0-max-preview`，2026-11-25 预览结束下线），并给 qwen3.8-max / qwen3.8-flash / qwen3.7-plus 补上套餐渠道。套餐模型标为 agentOnly。

  百炼对话有工具调用时，思考内容通过 `continuation.reasoningContent` 返回，下一轮同模型自动按 `reasoning_content` 回传。

- 8d90620: MiniMax 新增原生操作 `image-context-ir`（MCP 工具 `h3_image_context_ir`）：单独调用 `MiniMax-H3-Image` 的 Prompt 增强，同步返回增强后的 prompt，不生成图片；可带 1–16 张参考图按图片编辑增强。只有声明里标了 `native: ['image-context-ir']` 的模型可用，Highspeed 不支持。
- fb7322b: MiniMax 新增图片模型 `MiniMax-H3-Image` 和 `MiniMax-H3-Image-Highspeed`：没有参考图时文生图，带 1–16 张参考图时图片编辑；支持画幅 + 1K/2K/4K 面积档或自定义宽高（最大 2000 万像素）、输出格式与压缩质量、关闭提示词增强。MCP `generate_image` 新增 `images`（多张参考图）和 `resolution` 参数。MiniMax 的 OpenAI 风格错误按 message 末尾的业务码归类（如 1026 归为内容安全）。

### Patch Changes

- 6cf4aa3: MiniMax-H3-Image 文生图与图片编辑改用流式响应保活，避免 Node fetch 默认 300 秒收不到响应头就断开（服务端最长等 600 秒）。

## 0.3.0

### Minor Changes

- 1715702: 模型声明新增可选字段 `contextWindow`（一次请求输入加输出的总 token 数）和 `maxOutputTokens`（单次最多输出的 token 数），`ChannelRef` 可按渠道覆盖，`ModelInfo` 与 MCP `list_declared_models` 会带出。方舟、百炼、OpenAI、MiniMax 的对话模型已按官方文档补全数值；官方没有公布的模型不填。

## 0.2.2

### Patch Changes

- 2975cfe: 提示词里的参考素材引用改成各平台官方写法：方舟 Seedance 写「@图片N / @视频N / @音频N」，百炼万相 3.0 写「图N / 视频N / 音频N」（此前都被改写成 `@imageN`）。`ReferenceLabelStyle` 新增 `ark-video`、`bailian-video`，`videoReferencePrompt` 的平台参数新增 `bailian`；`referenceLabelStyle` 对方舟与百炼返回新写法。同时补全声明：z-image-turbo 每次 1 张、Seedance 2.5 的 `output_format`、MiniMax H3 的 `videoModes`（不开放仅尾帧）。

## 0.2.1

### Patch Changes

- 8228dd7: OpenAI 生图返回几 MB 的高分辨率图片时，base64 校验不再抛「Maximum call stack size exceeded」，避免已生成（已计费）的图片被当成提交状态未知丢掉。

## 0.2.0

### Minor Changes

- 84b5bee: 历史模型一律归档，不再支持：`retired` 的模型 SDK 与 MCP 都拒绝调用，MCP 工具 schema 不再列出，能力下全部归档时工具不再提供。MiniMax 的 `MiniMax-M2.7`、`music-3.0`、`music-2.6` 按官方模型列表的「历史模型」小节归档，MiniMax MCP 不再提供 `music_generation`。

### Patch Changes

- 89e1df7: 方舟补回 Responses API 的联网搜索（`web_search`）、续接响应（`previous_response_id`）与 `max_tool_calls`，以及多模态向量化 `embed`（MCP 工具 `embed`）。只对声明里支持的按量模型开放，套餐渠道直接拒绝。
- 9a9587c: npm 包补充关键词在前的描述与 keywords，README 里指向仓库根目录与文档的相对链接改为绝对地址，npm 页面上不再失效。

## 0.1.3

### Patch Changes

- 816fe0e: 方舟 MCP 支持套餐渠道：`ark-plan:` 前缀的模型走 Agent Plan（`ARK_AGENT_PLAN_API_KEY`），只配套餐 key 时默认走套餐；原来所有调用都按量计费，`ark-plan:` 模型也会用 `ARK_API_KEY` 发出。`PlatformDescriptor` 新增可选的 `channelSecrets`。
- de41805: 百炼：`happyhorse-1.0-video-edit` 改走新的原生操作 `edit-video`（MCP 工具 `edit_video`），`generate_video` 不再接受这个模型；口型同步返回 `task_id`，可以接着查询。
- b6dff9c: `doctor` 分开列出已配置和未配置的密钥名（`DoctorEntry.present`），不再把任选一组的所有名字列在一起，看起来像全都配好了。
- de41805: 豆包语音：播客返回音频文件输出（优先用平台给的音频 URL，否则拼接流式音频）；TTS 与 Seed Audio 的采样率写进模型声明（`limits.sampleRates`），校验和 MCP schema 都从声明派生；播客按官方文档单独校验。core 新增 `sampleRates` 上限与 `sampleRate` 参数种类。
- 039c35a: MiniMax：`design_voice` 的 `voice_id` 改为可选（不传时平台自动生成）；2K 重渲染两种模式都发送 `resolution`；`file_id` 按官方 int64 整数发送，超过 2^53 的值不丢精度；`context-ir` 与 2K 重渲染返回 `job_id` / `task_id`（原来是驼峰的 `taskId`）。

## 0.1.2

### Patch Changes

- 9e7b2f8: Add the `openai` MCP platform: `modelbay-mcp openai` serves `chat` (Responses API) and `generate_image` (generation, or editing when `images` are given) for the official OpenAI channel, plus the local `get_tool_help` and `list_capabilities` tools.
- MCP tools no longer advertise an `outputSchema` that requires an `ok` field their results never contained, so clients that validate structured results against `outputSchema` stop rejecting successful calls.

## 0.1.1

### Patch Changes

- Publish through npm trusted publishing (OIDC), so every package now carries npm provenance. No code changes from 0.1.0.
