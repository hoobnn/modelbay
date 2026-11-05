/** 测试用的伪造声明 / 适配器 / 盘点读取器。test/ 目录不计入覆盖率。 */
import { readFileSync } from 'node:fs'
import { createAdapterContext } from '@modelbay/core'
import type { ModelDeclaration, PlatformAdapter, SubmitResult } from '@modelbay/core'
import type { PlatformDescriptor } from '@modelbay/core'
import { resolvePlatform } from '../src/launch'

/** 有 MCP 工具目录、并有工具清单快照可对照的平台。 */
export const MCP_KEYS = ['ark', 'minimax', 'bailian', 'doubao-speech'] as const
export type McpKey = (typeof MCP_KEYS)[number]

/** 按平台键取注册表里的描述对象。 */
export function platformOf(key: string): PlatformDescriptor {
  return resolvePlatform(key)
}

/** 平台的 MCP 工具定义。 */
export function toolsOf(key: string) {
  return platformOf(key).mcp?.tools ?? []
}

const source = { url: 'https://example.com/docs/model', checkedAt: '2026-11-04' }

/** 覆盖 active / superseded / sunsetting，带 optionsSchema（上下限/默认值）与预置音色。 */
export const fakeModels: ModelDeclaration[] = [
  {
    id: 'chat-pro',
    title: 'Fake Chat Pro',
    canonicalId: 'fake/chat-pro',
    capabilities: ['text.chat', 'text.embed'],
    channels: [{ channel: 'ark', id: 'chat-pro' }],
    aliases: { official: [], short: ['pro'] },
    lifecycle: { status: 'active', source },
    source,
    default: true,
    optionsSchema: {
      type: 'object',
      properties: {
        max_tokens: { type: 'integer', minimum: 1, maximum: 8192, default: 2048 },
      },
    },
    voices: [{ id: 'v1', title: 'Voice One', gender: 'female' }],
  },
  {
    id: 'chat-old',
    title: 'Fake Chat Old',
    canonicalId: 'fake/chat-old',
    capabilities: ['text.chat'],
    channels: [{ channel: 'ark', id: 'chat-old' }],
    aliases: { official: [], short: ['old'] },
    lifecycle: { status: 'superseded', by: 'fake/chat-pro', source },
    source,
  },
  {
    id: 'chat-sunset',
    title: 'Fake Chat Sunset',
    canonicalId: 'fake/chat-sunset',
    capabilities: ['text.chat'],
    channels: [{ channel: 'ark', id: 'chat-sunset' }],
    aliases: { official: [], short: [] },
    lifecycle: { status: 'sunsetting', sunsetOn: '2026-12-01', source },
    source,
  },
]

export interface FakeAdapter {
  adapter: PlatformAdapter
  calls: { submit: unknown[]; native: unknown[] }
}

export function fakeAdapter(overrides: Partial<PlatformAdapter> = {}): FakeAdapter {
  const calls: { submit: unknown[]; native: unknown[] } = { submit: [], native: [] }
  const adapter: PlatformAdapter = {
    id: 'fake/ark',
    title: 'Fake Adapter',
    channels: ['ark'],
    models: fakeModels,
    nativeOperations: ['context-ir'],
    async submit(request) {
      calls.submit.push(request)
      return { ok: true, request } as unknown as SubmitResult
    },
    async native(op, params) {
      calls.native.push({ op, params })
      return { op, params }
    },
    ...overrides,
  }
  return { adapter, calls }
}

export function fakeContext(secrets: Record<string, string> = {}) {
  return createAdapterContext({ secrets, log: () => {} })
}

export interface InventoryTool {
  name: string
  description: string
  inputSchema: {
    type?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
    [key: string]: unknown
  }
  annotations?: Record<string, boolean>
}

/**
 * 读工具清单快照（2026-11-04 冻结，见 docs/mcp.md），逐个平台对照，防止工具或字段丢失。
 */
export function readInventory(platform: McpKey): InventoryTool[] {
  const url = new URL(`./baselines/${platform}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as InventoryTool[]
}
