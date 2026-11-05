/**
 * `@modelbay/shared` — 各平台适配器共用的运行时无关代码。
 *
 * 传输底座、OpenAI 兼容对话（Vercel AI SDK）、模型列表解析、多模态参考校验、
 * 音色试听下载与画幅尺寸换算。各平台包都从这里引用同一份实现；
 * 类型来自 `@modelbay/core`。
 */
export * from './http'
export * from './llm'
export * from './model-list'
export * from './size'
export * from './video-references'
export * from './voice-preview'
