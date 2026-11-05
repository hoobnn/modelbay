import { describe, expect, it } from 'vite-plus/test'
import {
  canBeDefault,
  selectDefaultModel,
  type ModelDeclaration,
  type ModelSource,
} from '@modelbay/core'
import { all } from '../src/models/index'

const source: ModelSource = { url: 'https://example.test/docs', checkedAt: '2026-11-04' }

function declaration(
  canonicalId: string,
  status: ModelDeclaration['lifecycle']['status'],
  extra: Partial<ModelDeclaration> = {},
): ModelDeclaration {
  return {
    canonicalId,
    id: canonicalId.split('/')[1] ?? canonicalId,
    title: canonicalId,
    capabilities: ['text.chat'],
    channels: [{ channel: 'openai', id: canonicalId.split('/')[1] ?? canonicalId }],
    aliases: {},
    lifecycle: { status, source },
    source,
    ...extra,
  }
}

describe('默认模型只能选 active', () => {
  const declarations = [
    declaration('openai/sunset', 'sunsetting', {
      lifecycle: { status: 'sunsetting', sunsetOn: '2026-11-24', source },
    }),
    declaration('openai/active', 'active', { default: true }),
    declaration('openai/retired', 'retired'),
  ]

  it('canBeDefault 只对 active 为真', () => {
    expect(canBeDefault(declarations[0]!)).toBe(false)
    expect(canBeDefault(declarations[1]!)).toBe(true)
    expect(canBeDefault(declarations[2]!)).toBe(false)
  })

  it('selectDefaultModel 只认标了 default 的 active 模型', () => {
    expect(selectDefaultModel(declarations, 'text.chat')?.declaration.canonicalId).toBe(
      'openai/active',
    )
    expect(selectDefaultModel([declarations[0]!, declarations[2]!], 'text.chat')).toBeNull()
  })

  it('按 channel 过滤默认模型', () => {
    expect(selectDefaultModel(declarations, 'text.chat', 'openai-compatible')).toBeNull()
  })
})

describe('声明加载', () => {
  it('all 是声明数组，每项都有 canonicalId', () => {
    expect(Array.isArray(all)).toBe(true)
    for (const item of all) expect(item.canonicalId).toContain('/')
  })
})
