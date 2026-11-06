/** 0003：归一化能力与 native 操作的划分。 */
import { z } from 'zod'
import { Capability } from './provider'

/** 基础 9 种能力，类型定义以 provider.ts 为准 */
export const LEGACY_CAPABILITIES = Capability.options

/** 0003 新增：两家及以上平台都有的能力 */
export const ADDITIONAL_CAPABILITIES = [
  'voice.clone',
  'voice.design',
  'voice.list',
  'text.embed',
] as const

export const NormalizedCapability = z.enum([...LEGACY_CAPABILITIES, ...ADDITIONAL_CAPABILITIES])
export type NormalizedCapability = z.infer<typeof NormalizedCapability>

export const NORMALIZED_CAPABILITIES = NormalizedCapability.options

export function isNormalizedCapability(value: string): value is NormalizedCapability {
  return NORMALIZED_CAPABILITIES.some((item) => item === value)
}

/** 只有一家平台有的能力：参数 schema 由适配器自己声明，MCP 仍能为它生成工具 */
export const NATIVE_OPERATIONS = [
  'rerank',
  'digital-human-lipsync',
  'edit-video',
  'context-ir',
  'video-2k-rerender',
  'podcast',
  'simultaneous-interpretation',
  'translation',
  'meeting-notes',
  'console-management',
  'hotword-table',
  'raw-request',
] as const
export type NativeOperationName = (typeof NATIVE_OPERATIONS)[number]

export interface NativeOperation {
  op: string
  params: Record<string, unknown>
}

export function native(op: string, params: Record<string, unknown> = {}): NativeOperation {
  return { op, params }
}

/**
 * 实时对话不走 submit / poll：单独定义 session 接口。
 * 适配器按需实现，不套进异步任务模型。
 */
export interface RealtimeSession {
  send(data: Uint8Array): void
  receive(): Promise<Uint8Array>
  close(): void
}
