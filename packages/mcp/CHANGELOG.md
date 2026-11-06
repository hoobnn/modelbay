# @modelbay/mcp

## 0.1.3

### Patch Changes

- 816fe0e: 方舟 MCP 支持套餐渠道：`ark-plan:` 前缀的模型走 Agent Plan（`ARK_AGENT_PLAN_API_KEY`），只配套餐 key 时默认走套餐；原来所有调用都按量计费，`ark-plan:` 模型也会用 `ARK_API_KEY` 发出。`PlatformDescriptor` 新增可选的 `channelSecrets`。
- de41805: 百炼：`happyhorse-1.0-video-edit` 改走新的原生操作 `edit-video`（MCP 工具 `edit_video`），`generate_video` 不再接受这个模型；口型同步返回 `task_id`，可以接着查询。
- de41805: 豆包语音：播客返回音频文件输出（优先用平台给的音频 URL，否则拼接流式音频）；TTS 与 Seed Audio 的采样率写进模型声明（`limits.sampleRates`），校验和 MCP schema 都从声明派生；播客按官方文档单独校验。core 新增 `sampleRates` 上限与 `sampleRate` 参数种类。
- b15bd05: 新增环境变量 `MODELBAY_MCP_OUT_DIR`：调用没给 `out_dir` 时，文件结果落到 `<目录>/<平台>`，显式 `out_dir` 仍然优先。原生操作直接带回文件的（如豆包播客）也按同样规则落盘；原生异步任务返回的 `task_id` 登记进 `list_jobs`。
- 039c35a: MiniMax：`design_voice` 的 `voice_id` 改为可选（不传时平台自动生成）；2K 重渲染两种模式都发送 `resolution`；`file_id` 按官方 int64 整数发送，超过 2^53 的值不丢精度；`context-ir` 与 2K 重渲染返回 `job_id` / `task_id`（原来是驼峰的 `taskId`）。
- Updated dependencies [816fe0e]
- Updated dependencies [de41805]
- Updated dependencies [b6dff9c]
- Updated dependencies [de41805]
- Updated dependencies [039c35a]
  - modelbay@0.1.3

## 0.1.2

### Patch Changes

- 9e7b2f8: Add the `openai` MCP platform: `modelbay-mcp openai` serves `chat` (Responses API) and `generate_image` (generation, or editing when `images` are given) for the official OpenAI channel, plus the local `get_tool_help` and `list_capabilities` tools.
- MCP tools no longer advertise an `outputSchema` that requires an `ok` field their results never contained, so clients that validate structured results against `outputSchema` stop rejecting successful calls.
- Updated dependencies [9e7b2f8]
  - modelbay@0.1.2

## 0.1.1

### Patch Changes

- Publish through npm trusted publishing (OIDC), so every package now carries npm provenance.
- Report the real package version in MCP `serverInfo` (0.1.0 always reported `0.1.0`).
- Updated dependencies
  - modelbay@0.1.1
