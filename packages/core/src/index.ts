/**
 * `@modelbay/core` — runtime-agnostic types, validation and model declarations.
 *
 * Everything here works in Node, Bun, Deno and browsers: no `node:` imports,
 * no Node globals. Platform adapters live in `@modelbay/<platform>`.
 */

// 从 plein 的 plugin-sdk 原样搬过来的 provider 类型与输入校验（M1）
export * from './provider'
export * from './model-params'
export * from './media-requirements'
export * from './image-input'
export * from './video-input'
export * from './ids'
export * from './ports'
export * from './media'
export * from './reference-tokens'

// 0003 能力划分、声明格式、运行时契约（G1/G4/G5）
export * from './capabilities'
export * from './declarations'
export * from './model-limits'
export * from './schema'
export * from './runtime'
export * from './adapter'
export * from './platform'
