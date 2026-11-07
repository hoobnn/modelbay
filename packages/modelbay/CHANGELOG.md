# modelbay

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
