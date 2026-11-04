/** 测试用的伪造声明 / 适配器 / 盘点读取器。test/ 目录不计入覆盖率。 */
import { readFileSync } from 'node:fs'
import { createAdapterContext } from '@modelbay/core'
import type { ModelDeclaration, PlatformAdapter, SubmitResult } from '@modelbay/core'
import { PLATFORMS } from '../src/platform'
import type { PlatformKey } from '../src/types'

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

/** 直接读盘点基线（不是 catalog 生成物），逐个平台对照用。 */
export function readInventory(platform: PlatformKey): InventoryTool[] {
  const file = PLATFORMS[platform].inventoryFile
  const url = new URL(`../../../docs/inventory/${file}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as InventoryTool[]
}
