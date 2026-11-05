import { describe, expect, it } from 'vite-plus/test'
import {
  canBeDefault,
  selectDefaultModel,
  type ModelDeclaration,
  type ModelSource,
} from '@modelbay/core'
import { allModels as all } from '../src/declarations'
import { synthesizePlanSpeech } from '../src/speech'
import { fakeContext, jsonResponse } from './helpers'

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
    channels: [{ channel: 'ark', id: canonicalId.split('/')[1] ?? canonicalId }],
    aliases: {},
    lifecycle: { status, source },
    source,
    ...extra,
  }
}

describe('默认模型只能选 active', () => {
  const declarations = [
    declaration('volc/sunset', 'sunsetting', {
      lifecycle: { status: 'sunsetting', sunsetOn: '2026-11-24', source },
    }),
    declaration('volc/active', 'active'),
    declaration('volc/retired', 'retired'),
  ]

  it('canBeDefault 只对 active 为真', () => {
    expect(canBeDefault(declarations[0]!)).toBe(false)
    expect(canBeDefault(declarations[1]!)).toBe(true)
    expect(canBeDefault(declarations[2]!)).toBe(false)
  })

  it('selectDefaultModel 跳过非 active 模型', () => {
    expect(selectDefaultModel(declarations, 'text.chat')?.declaration.canonicalId).toBe(
      'volc/active',
    )
    expect(selectDefaultModel([declarations[0]!, declarations[2]!], 'text.chat')).toBeNull()
  })

  it('按 channel 过滤默认模型', () => {
    expect(selectDefaultModel(declarations, 'text.chat', 'ark-plan')).toBeNull()
  })
})

describe('声明加载', () => {
  it('all 是声明数组，每项都有 canonicalId', () => {
    expect(Array.isArray(all)).toBe(true)
    for (const item of all) expect(item.canonicalId).toContain('/')
  })
})

describe('方舟套餐 TTS 的跨包复用', () => {
  // 豆包分块响应：一段音频 + 合成结束标记（code 20000000）
  const stream = '{"code":0,"data":"AQID"}{"code":20000000,"data":""}'

  it('静态复用 doubao-speech 的 synthesizeSpeech 并走 plan 专属端点', async () => {
    const { ctx, fetch } = fakeContext([new Response(stream, { status: 200 })], {
      secret: { VOLC_SPEECH_API_KEY: 'test-key' },
    })
    const result = await synthesizePlanSpeech({ text: '你好' }, ctx)
    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') return
    expect(result.outputs[0]).toMatchObject({
      type: 'file',
      kind: 'audio',
      mime: 'audio/mpeg',
    })
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional')
  })

  it('上游失败按对方的 ProviderError 原样传播', async () => {
    const { ctx } = fakeContext(
      [jsonResponse({ header: { code: 45000001, message: '音色无效' } }, 400)],
      { secret: { VOLC_SPEECH_API_KEY: 'test-key' } },
    )
    await expect(synthesizePlanSpeech({ text: '你好' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
