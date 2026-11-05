# 声明抽取逐项比对报告

> 本报告由 `node scripts/compare-inventory.mjs` 生成，`export-declarations.mjs` 末尾会自动调用。
> 基准：`docs/inventory/plein-models.json`；产物：`declarations/**/*.json` 与 `packages/*/src/models/*.ts`。
> 来源与核对日期：2026-11-05 逐个打开官方原文核对过；只有真正读到正文的页面才写当天的 `checkedAt`，读不到正文的保持 2026-11-04（清单见第三节）。

## 一、结论摘要

| 项                   | 数量                                     |
| -------------------- | ---------------------------------------- |
| 基准 provider        | 7                                        |
| 基准模型（含 mock）  | 84                                       |
| mock（跳过）         | 8                                        |
| 静态模型（待抽取）   | 76                                       |
| 生成声明文件         | 66                                       |
| 数量差异             | -10（方舟按量/套餐同 id 合并，见第七节） |
| 逐字段完全一致的声明 | 64                                       |
| 内容/顺序差异条目    | 7（见第六节，全部逐条说明）              |

平台分布：

| 平台包        | 声明数 | 渠道          |
| ------------- | ------ | ------------- |
| ark           | 32     | ark、ark-plan |
| bailian       | 11     | bailian       |
| doubao-speech | 5      | doubao-speech |
| minimax       | 12     | minimax       |
| openai        | 6      | openai        |

## 二、平台映射与跳过说明

| 原 provider    | 平台包        | 渠道 channel  | canonicalId 厂商前缀 |
| -------------- | ------------- | ------------- | -------------------- |
| minimax/api    | minimax       | minimax       | minimax              |
| doubao/speech  | doubao-speech | doubao-speech | doubao               |
| openai/api     | openai        | openai        | openai               |
| aliyun/bailian | bailian       | bailian       | aliyun               |
| volc/ark-plan  | ark           | ark-plan      | volc                 |
| volc/ark       | ark           | ark           | volc                 |

`plein/mock` 不是真实平台（仅开发测试用），整组跳过，不生成声明：

- 跳过 8 个：`agent`、`agent-vision`、`chat`、`image`、`image-process`、`image-edit`、`video`、`audio`。

百炼里模型 id 以 `MiniMax/` 开头的转售型号，会额外加一条 `{ channel: 'minimax', id: <去掉前缀> }` 渠道；本次静态清单中不含此类 id，规则未触发。

## 三、来源与核对日期

- 每个声明的 `source` 与 `lifecycle.source` 都是 `{ url, checkedAt }`；`checkedAt` 是实际读到该页官方原文的日期。
- 2026-11-05 逐个打开了声明里的 `source.url` 核对状态、默认值与主要上限：真正读到正文的页面 `checkedAt` 写成 2026-11-05；正文由前端渲染、读不到内容的页面保持 2026-11-04，并在下面的表里列出。
- `source.url` 用各平台官方模型列表/文档页；`lifecycle.source.url` 对有特殊状态的模型优先用 `docs/inventory.md` 第三节列出的官方公告链接。

### 2026-11-05 逐页核对结果

| 官方页面                                                                                      | 读到正文             | 用到的声明                                                 |
| --------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `https://docs.volcengine.com/docs/ark/model-list?lang=zh`                                     | 是                   | 方舟按量渠道的全部模型                                     |
| `https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview` | 是                   | 方舟套餐渠道的模型（套餐概览）                             |
| `https://help.aliyun.com/zh/model-studio/models`                                              | 是                   | 百炼文本模型与 qwen-image-3.0-pro、wan2.7-image-pro        |
| `https://help.aliyun.com/zh/model-studio/image-model`                                         | 是                   | 百炼 qwen-image-3.0、qwen-image-3.0-pro、wanx2.1-imageedit |
| `https://help.aliyun.com/zh/model-studio/video-generation`                                    | 是                   | 百炼 wan3.0-video、wan3.0-video-prime                      |
| `https://help.aliyun.com/zh/model-studio/tts-model`                                           | 是                   | 百炼配音系列                                               |
| `https://platform.minimax.cn/docs/faq/models`                                                 | 是                   | MiniMax 全部模型（含已下线的历史模型）                     |
| `https://platform.minimax.cn/docs/api-reference/video-generation-v2-create`                   | 是                   | MiniMax-H3-Highspeed、MiniMax-H3-Lite、MiniMax-H3-Max      |
| `https://platform.minimax.cn/docs/api-reference/music-generation`                             | 是                   | music-3.0 的生命周期来源                                   |
| `https://platform.openai.com/docs/models`                                                     | 是                   | OpenAI 全部模型                                            |
| `https://docs.volcengine.com/docs/6561/2499930`                                               | 是                   | 豆包语音模型列表（seed-audio-1.0）                         |
| `https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http`   | 是                   | seed-tts-2.0、seed-icl-2.0                                 |
| `https://docs.volcengine.com/docs/6561/1354869`                                               | 是                   | bigmodel（流式语音识别）                                   |
| `https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh`                       | 否（正文由前端渲染） | doubao-seedream-5-0-260128 的下线公告                      |

读不到正文的页面保持 `checkedAt = 2026-11-04`，涉及的声明：

- `volc/ark-code-latest`
- `volc/custom-chat`
- `volc/custom-image`
- `volc/custom-video`
- `volc/kimi-k2.7-code`
- `volc/minimax-m3`
- `volc/doubao-seedream-5-0-260128`
- `aliyun/qwen3-tts-instruct-flash`
- `doubao/seed-icl-1.0`

逐页核对中发现的出入（按官方原文改了声明）：

- 方舟套餐渠道的模型 ID 用点号写法（`doubao-seed-2.1-pro`、`glm-5.3`、`kimi-k3.1-pro`），只出现在「套餐概览」页，原来挂的「模型列表」页里没有；这些声明的 `source` 改指套餐概览页。
- 百炼的图像编辑与视频生成模型（`qwen-image-3.0`、`wanx2.1-imageedit`、`wan3.0-video`、`wan3.0-video-prime`）不在「模型大全」页，改指图像生成页 / 视频生成页。
- MiniMax 的模型清单在「模型列表」页（`/docs/faq/models`），原来的 `/docs/api-reference` 会跳到「Prompt 缓存」页；H3 的 Highspeed / Lite 变体只在视频生成接口页出现。
- 豆包语音的 `seed-tts-2.0`、`seed-icl-2.0`、`bigmodel`、`seed-audio-1.0` 各自改指对应的接口页；`seed-icl-1.0` 暂时找不到能读到正文的页面，保持原样。

| 平台          | 默认官方链接（source.url）                                |
| ------------- | --------------------------------------------------------- |
| ark           | `https://docs.volcengine.com/docs/ark/model-list?lang=zh` |
| bailian       | `https://help.aliyun.com/zh/model-studio/models`          |
| minimax       | `https://platform.minimax.cn/docs/faq/models`             |
| doubao-speech | `https://docs.volcengine.com/docs/6561/2499930`           |
| openai        | `https://platform.openai.com/docs/models`                 |

`docs/inventory.md` 第三节列出的 3 个官方来源链接，以及 Seedream 下线公告（`lifecycle.source` 特殊状态用）：

- MiniMax 音乐生成接口：`https://platform.minimax.cn/docs/api-reference/music-generation`（music-3.0）
- 火山方舟下线公告：`https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh`（Seedream 5.0 Lite）
- 百炼语音合成模型：`https://help.aliyun.com/zh/model-studio/tts-model`（Qwen-Audio-TTS 系列）
- 火山方舟模型列表：`https://docs.volcengine.com/docs/ark/model-list?lang=zh`（同平台默认链接）

## 四、生命周期状态映射

`deprecated: true` 逐条对照官方原文映射成 0003 生命周期枚举，不一律 `retired`。规则：

| 模型 / 条件                               | 原标记     | 映射状态               | 附加字段                     | 官方来源                                                                |
| ----------------------------------------- | ---------- | ---------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| MiniMax `music-3.0`                       | deprecated | closed-to-new-accounts | since: 2026-08-20            | `https://platform.minimax.cn/docs/api-reference/music-generation`       |
| Seedream 5.0 Lite 两个 ID                 | deprecated | sunsetting             | sunsetOn: 2026-11-24         | `https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh` |
| 百炼 `qwen-audio-3.0-tts-flash`（若存在） | deprecated | superseded             | by: qwen-audio-3.1-tts-flash | `https://help.aliyun.com/zh/model-studio/tts-model`                     |
| 其余 deprecated 且查不到官方原文          | deprecated | active（不伪造）       | 列入待核对清单               | 无                                                                      |
| 所有其他模型                              | —          | active                 | —                            | 平台默认链接                                                            |

已按规则落地：

| canonicalId                     | 原标记           | 新状态                 | 依据                                                                                                          |
| ------------------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| minimax/music-3.0               | deprecated: true | closed-to-new-accounts | inventory.md 第三节：自 2026-08-20 起付费接口不再向新用户开放，历史付费用户可继续使用；music-3.0 仍是推荐型号 |
| volc/doubao-seedream-5-0-260128 | deprecated: true | sunsetting             | inventory.md 第三节 + 下线公告：停止新购，2026-11-24 14:00（UTC+8）关停                                       |

### 待核对清单（4 个）

这些模型在 plein 里带 `deprecated: true`，但本次找不到对应的官方下线/状态公告原文，**不伪造状态**，一律保持 `active`，仅在此列出：

| provider       | 模型 id                  | 原始 deprecated | 原始说明                                                                         | 缺失项                            | 处理                                                   |
| -------------- | ------------------------ | --------------- | -------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| minimax/api    | MiniMax-M2.7             | true            | 已停止向新用户开放；按量付费存量用户可调用至 2026-11-18，请提前迁移至 M3.1 Flash | 未找到对应的官方下线/状态公告原文 | lifecycle.status 保持 active，不写入任何非 active 状态 |
| aliyun/bailian | qwen3-tts-instruct-flash | true            | 已于 2026-10-10 下线；仅保留旧画布引用，请改用 qwen3-tts-flash 或豆包语音        | 未找到对应的官方下线/状态公告原文 | lifecycle.status 保持 active，不写入任何非 active 状态 |
| volc/ark-plan  | minimax-m3               | true            | Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位                  | 未找到对应的官方下线/状态公告原文 | lifecycle.status 保持 active，不写入任何非 active 状态 |
| volc/ark-plan  | kimi-k2.7-code           | true            | Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位                  | 未找到对应的官方下线/状态公告原文 | lifecycle.status 保持 active，不写入任何非 active 状态 |

### 未触发 / 待补

- qwen-audio-3.0-tts-flash → superseded / qwen-audio-3.1-tts-flash → 默认 / qwen3-tts-flash 不当默认：plein 静态清单不含 Qwen-Audio-TTS 3.0/3.1 系列（仅在 MCP 侧），本次无对应声明；默认模型由 core 的 selectDefaultModel() 统一选，声明数据不写死默认标记；qwen3-tts-flash 保持 active。M3 补齐该系列后再落地默认切换。

## 五、别名处理

`aliases` 含 `official`（同模型的多个官方 ID）与 `short`（简称）两类，均以数组字面量写入，并保证全局不冲突。

从 MCP 工具清单识别到的简称词：`audio`、`fast`、`flash`、`hd`、`highspeed`、`lite`、`max`、`mini`、`plus`、`pro`、`qwen`、`seedance`、`wan`、`z`。

采用的 `short` 别名（从模型 id 末段识别、全局唯一）：

| canonicalId                  | short       |
| ---------------------------- | ----------- |
| minimax/MiniMax-H3-Highspeed | `highspeed` |
| minimax/speech-2.8-hd        | `hd`        |
| aliyun/qwen3.7-plus          | `plus`      |
| volc/doubao-seed-2.0-mini    | `mini`      |

`official` 别名：

| canonicalId                     | official                          | 依据                      |
| ------------------------------- | --------------------------------- | ------------------------- |
| volc/doubao-seedream-5-0-260128 | `doubao-seedream-5-0-lite-260128` | 下线公告里的另一个官方 ID |

未采用的简称及原因：

| 简称       | 涉及型号                                                                                                                                          | 原因                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `flash`    | `MiniMax-M3.1-Flash`、`qwen3.8-flash`、`qwen3-tts-flash`、`qwen3-tts-instruct-flash`、`deepseek-v4-flash`、`deepseek-v4.1-flash`、`glm-5.3-flash` | 全局冲突（多个型号共用该简称）                         |
| `lite`     | `MiniMax-H3-Lite`、`doubao-seed-2.1-lite`                                                                                                         | 全局冲突（多个型号共用该简称）                         |
| `max`      | `MiniMax-H3-Max`、`qwen3.8-max`                                                                                                                   | 全局冲突（多个型号共用该简称）                         |
| `pro`      | `qwen-image-3.0-pro`、`wan2.7-image-pro`、`doubao-seed-2.1-pro`、`deepseek-v4-pro`、`kimi-k3.1-pro`                                               | 全局冲突（多个型号共用该简称）                         |
| `audio`    | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |
| `fast`     | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |
| `qwen`     | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |
| `seedance` | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |
| `wan`      | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |
| `z`        | （无唯一映射）                                                                                                                                    | MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型 |

说明：MCP 清单里的 `pro` / `flash` / `wan` 等是**工具级参数别名**，跨工具同名但指向不同模型（例如方舟 `chat` 的 `pro` 指 Seed 2.1 pro、`generate_image` 的 `pro` 指 Seedream 5.0 Pro），不能安全地作为模型级全局别名；为保证「别名不冲突」，只采用能从模型 id 唯一识别、且全局只被一个声明占用的型号后缀简称。别名不等于任何模型的 id 或 canonicalId。

## 六、逐项字段比对

### 6.1 比对范围

比对字段：`id`、`title`、`capabilities`、`limits`、`voices`、`features`、`description`、`agentOnly`。
基准取 `plein-models.json` 中同 id 的原始模型；方舟同 id 在 `volc/ark-plan` 与 `volc/ark` 各有一条，声明取按量侧（`volc/ark`）为主来源。

- 逐字段完全一致的声明：64 / 66。
- 基准中含 `options` 的模型：28；生成 `optionsSchema` 的声明：22；因转不出而省略：0；其余差额 6 来自方舟两渠道同 id 合并（两条原始记录合成一条声明）。
- 基准中含 `deprecated` 的模型：6。

### 6.2 差异明细（逐条）

| 平台 | 模型 id              | 字段          | 基准值                                                          | 声明值                           | 来源 provider | 原因                                                                         |
| ---- | -------------------- | ------------- | --------------------------------------------------------------- | -------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| ark  | custom-chat          | `title`       | 自定义套餐对话模型                                              | 自定义对话模型（设置中填写）     | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |
| ark  | custom-chat          | `features`    | ["tools","structured"]                                          | ["structured"]                   | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |
| ark  | custom-chat          | `agentOnly`   | true                                                            | （无）                           | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |
| ark  | doubao-seed-evolving | `title`       | doubao-seed-evolving                                            | Doubao Seed Evolving（快速迭代） | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |
| ark  | doubao-seed-evolving | `features`    | ["tools","structured","vision"]                                 | ["tools","vision","structured"]  | volc/ark-plan | 方舟两渠道合并：features 集合相同、顺序写法不同，取按量侧顺序                |
| ark  | doubao-seed-evolving | `description` | Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位 | （无）                           | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |
| ark  | doubao-seed-evolving | `agentOnly`   | true                                                            | （无）                           | volc/ark-plan | 方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源 |

### 6.3 字段转换与新增（结构性差异）

- `deprecated`：不写入声明，改由 `lifecycle.status` 表达（见第四节）。
- `options`：zod 内部结构转成 `optionsSchema`（`{ type: 'object', properties: {...} }`），声明不保留 `options` / `def` / `innerType`；转不出的省略 `optionsSchema`。
- 新增字段：`canonicalId`、`channels`、`aliases`、`lifecycle`、`source`（均为 0003 要求）；`capabilities` 沿用 plein 原有 9 种，未硬加 0003 新增的归一化能力。
- `description` / `features` / `limits` / `voices` / `agentOnly` / `title` / `id` 等原有字段原样保留。

转换明细：

| 模型 id                          | 字段         | 处理                                                           | 原因                                                             |
| -------------------------------- | ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| doubao-seedance-2-0-260128       | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedance-2-0-fast-260128  | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedance-2-0-mini-260615  | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedance-2-5-260628       | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedream-5-0-260128       | `deprecated` | 不写入声明；映射为 lifecycle.status = 'sunsetting'             | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| doubao-seedream-5-0-260128       | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedream-5-0-flash-260915 | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| doubao-seedream-5-0-pro-260628   | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| kimi-k2.7-code                   | `deprecated` | 不写入声明；映射为 lifecycle.status = 'active'                 | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| minimax-m3                       | `deprecated` | 不写入声明；映射为 lifecycle.status = 'active'                 | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| qwen-image-3.0-pro               | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| qwen-image-3.0                   | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| qwen3-tts-instruct-flash         | `deprecated` | 不写入声明；映射为 lifecycle.status = 'active'                 | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| wan2.7-image-pro                 | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| wan3.0-video-prime               | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| wan3.0-video                     | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| image-01-live                    | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| image-01                         | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| MiniMax-M2.7                     | `deprecated` | 不写入声明；映射为 lifecycle.status = 'active'                 | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| music-3.0                        | `deprecated` | 不写入声明；映射为 lifecycle.status = 'closed-to-new-accounts' | 0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated |
| speech-2.8-hd                    | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| speech-2.8-turbo                 | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-6.1-sol                      | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-6.1-terra                    | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-6-astra                      | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-6-luna                       | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-image-2.5-flare              | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |
| gpt-image-2.5-sunburst           | `options`    | 转成 optionsSchema（简单 JSON Schema）                         | options 是 zod 内部结构，声明是纯数据，不保留 def/innerType      |

## 七、方舟两渠道合并

`volc/ark-plan`（套餐）与 `volc/ark`（按量）归到同一个 `ark` 包。两个 provider 里 id 相同的模型合并成**一条声明、两条 channel**（`ark` 与 `ark-plan`），canonicalId 相同。

共同 id 共 10 个，因此静态模型 76 个合并成声明 66 个（少 10 个）：

| 模型 id                          | 来源 provider           | 合并后 channels | 主来源   |
| -------------------------------- | ----------------------- | --------------- | -------- |
| doubao-seedream-5-0-pro-260628   | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seedream-5-0-flash-260915 | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seedance-2-5-260628       | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seedance-2-0-260128       | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seedance-2-0-fast-260128  | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seedance-2-0-mini-260615  | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| custom-image                     | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| custom-video                     | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| doubao-seed-evolving             | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |
| custom-chat                      | volc/ark-plan、volc/ark | ark、ark-plan   | volc/ark |

其中 3 个模型在两渠道间字段取值不同，逐条列出（声明统一取主来源值）：

| 模型 id                    | 字段          | 主来源(volc/ark)值                           | 另一渠道值                                                                         |
| -------------------------- | ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| doubao-seedance-2-5-260628 | `options`     | （zod 内部结构，完整值见 plein-models.json） | （zod 内部结构，完整值见 plein-models.json）（volc/ark-plan）                      |
| doubao-seed-evolving       | `title`       | "Doubao Seed Evolving（快速迭代）"           | "doubao-seed-evolving"（volc/ark-plan）                                            |
| doubao-seed-evolving       | `description` | （无）                                       | "Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位"（volc/ark-plan） |
| doubao-seed-evolving       | `features`    | ["tools","vision","structured"]              | ["tools","structured","vision"]（volc/ark-plan）                                   |
| doubao-seed-evolving       | `agentOnly`   | （无）                                       | true（volc/ark-plan）                                                              |
| custom-chat                | `title`       | "自定义对话模型（设置中填写）"               | "自定义套餐对话模型"（volc/ark-plan）                                              |
| custom-chat                | `features`    | ["structured"]                               | ["tools","structured"]（volc/ark-plan）                                            |
| custom-chat                | `agentOnly`   | （无）                                       | true（volc/ark-plan）                                                              |

说明：`agentOnly`、`features` 顺序、`description`、`options` 等差异属于套餐渠道（内置 Agent）特有或写法不同；合并后声明的模型级字段取按量侧，渠道差异体现在 `channels` 上。

## 八、声明自检

由 `node scripts/check-declarations.mjs`（`pnpm check:declarations`）执行，覆盖：

- TS 声明为纯数据、`export default { ... } satisfies ModelDeclaration`；
- 每个 JSON 声明能按 core 的 `declarationJsonSchema()` 思路生成合法 JSON Schema；
- `source.url` / `source.checkedAt` / `lifecycle.source.url` / `lifecycle.source.checkedAt` 齐备且格式合法；
- `lifecycle.status` 合法；非 `active` 不能带默认标记；
- 别名跨声明不冲突、不与模型 id / canonicalId 冲突；
- 声明不含 `deprecated` / `options`，`optionsSchema` 不含 zod 内部字段。
