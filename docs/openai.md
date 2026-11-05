# OpenAI 接入核对

核对日期：2026-11-05。范围为 Modelbay 已有的文本、视觉输入、工具调用、结构化输出、图片生成与编辑，并提供原生 Responses JSON 入口承载归一化输出未表达的能力。

## 本次补齐

- GPT-6.1 Sol / GPT-6 Astra 的 `xhigh`、`max`；GPT-6.1 Terra / GPT-6 Luna 的 `none`、`xhigh`、`max`。
- Responses 的推理模式、摘要、上下文、回答详略、服务档位、并行工具、缓存、存储与会话选项。按模型声明检查参数，保留原生字段；不能覆盖归一化输入。
- GPT-Image-2.6 Sunburst / Flare，以及复杂度、SVG、GIF；2.5 补齐压缩、安全标识、标记引导编辑与官方快照别名。
- 参考图与蒙版编辑的输出尺寸；格式组合检查、正确 MIME、图片及 SVG author token 用量。
- `native('raw-request')` 返回完整 Responses JSON：内置工具、异步工具、原生 input items、后台生成、检索、取消、删除与压缩。

默认模型维持原值。旧声明没有官方下线或停用依据，保持 active；没有因为出现新版本而擅自标记 retired / superseded。

## 官方依据

| 内容                            | 来源                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 当前文本型号、推理强度、工具    | [GPT-6 指南](https://developers.openai.com/api/docs/guides/latest-model)、[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)、[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| 推理模式、摘要与上下文          | [Reasoning](https://developers.openai.com/api/docs/guides/reasoning)                                                                                                                                                                                                                                                                                   |
| API 路线与状态                  | [迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[后台生成](https://developers.openai.com/api/docs/guides/background)、[上下文压缩](https://developers.openai.com/api/docs/guides/compaction)                                                                                                                           |
| 缓存参数                        | [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)                                                                                                                                                                                                                                                                         |
| 新图片模型                      | [2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)、[2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)                                                                                                                                                                                   |
| 图片格式、复杂度、markup 与尺寸 | [图片指南](https://developers.openai.com/api/docs/guides/image-generation)、[生成参考](https://developers.openai.com/api/reference/resources/images/methods/generate)、[编辑参考](https://developers.openai.com/api/reference/resources/images/methods/edit)                                                                                           |

## 文档差异与明确边界

- GIF 帧数：指南写 2–64，生成接口参考写 2–16。声明先采用共同支持的 2–16；帧间隔采用指南的 20–2000 ms。默认值分别为 9 帧和 200 ms。以后原文统一再放宽，不靠猜测。
- GIF / SVG 编辑：编辑接口参考复用了生成字段，但指南明确两种格式只支持 generations。本地禁止把它们与参考图、蒙版或 markup 混用。
- 图片 2.6 的单边、总像素、动画总像素预算尚未在读取的模型页明确列齐。只校验已确认的正整数与 16 倍数，最终模型限制由 API 检查；不把 2.5 的 4K 上限擅自移植给 2.6。2.6 画质仅声明通用已确认的 auto / low / medium / high。
- `all_turns` 只在本次模型中对已确认的 GPT-6.1 Sol 展示；Ultrafast 只对已确认的 Sol / Astra 展示。是否有权限由 API 判断。
- 标记层的透明度、方向修正后尺寸和像素预算由宿主准备，上游校验。蒙版编辑继续注入 Node 的 alpha 转换器，不把标记层冒充蒙版。
- 归一化聊天仍只返回文本、函数调用或结构化 JSON。摘要、引用、响应 ID、原生工具输出和 compaction items 要使用原生入口保存，不能依赖归一化结果完整重放。
- 未新增 OpenAI 音频、Realtime、批处理、文件管理、Embeddings 的专门适配，也未实现 WebSocket 和 mid-turn steering。这些属于后续能力扩展，不在本次文本与图片更新范围内。
- 本次验证使用离线应答，不代表账户权限与真实付费调用已验收。
