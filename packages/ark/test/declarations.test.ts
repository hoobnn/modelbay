import { describe, expect, it } from 'vite-plus/test'
import {
  canBeDefault,
  selectDefaultModel,
  type ModelDeclaration,
  type ModelSource,
} from '@modelbay/core'
import { allModels as all } from '../src/declarations'
import { synthesizePlanSpeech } from '../src/speech'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

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
    declaration('volc/active', 'active', { default: true }),
    declaration('volc/retired', 'retired'),
  ]

  it('canBeDefault 只对 active 为真', () => {
    expect(canBeDefault(declarations[0]!)).toBe(false)
    expect(canBeDefault(declarations[1]!)).toBe(true)
    expect(canBeDefault(declarations[2]!)).toBe(false)
  })

  it('selectDefaultModel 只认标了 default 的 active 模型', () => {
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

describe('方舟套餐渠道的 ID', () => {
  // 套餐概览页（2026-11-05 核对）上的写法：点号 / 短横线照抄；
  // Seedream Pro 以套餐模型目录接口为准（接口返回点号写法）。
  const OVERVIEW = 'agent-plan-personal-plan-overview'
  const PLAN_IDS: Record<string, { id: string; source: string }> = {
    'volc/doubao-seedream-5-0-pro-260628': {
      id: 'doubao-seedream-5.0-pro',
      source: 'list-ark-agent-plan-model-api',
    },
    'volc/doubao-seedream-5-0-flash-260915': { id: 'doubao-seedream-5.0-flash', source: OVERVIEW },
    'volc/doubao-seedance-2-0-260128': { id: 'doubao-seedance-2.0', source: OVERVIEW },
    'volc/doubao-seedance-2-0-fast-260128': { id: 'doubao-seedance-2.0-fast', source: OVERVIEW },
    'volc/doubao-seedance-2-0-mini-260615': { id: 'doubao-seedance-2.0-mini', source: OVERVIEW },
    'volc/doubao-seedance-2-5-260628': { id: 'doubao-seedance-2.5', source: OVERVIEW },
    'volc/doubao-embedding-vision': { id: 'doubao-embedding-vision', source: OVERVIEW },
    'volc/doubao-seed-evolving': { id: 'doubao-seed-evolving', source: OVERVIEW },
  }

  it('渠道内 ID 与套餐概览页一致，并带渠道级来源', () => {
    for (const [canonicalId, expected] of Object.entries(PLAN_IDS)) {
      const found = all.find((item) => item.canonicalId === canonicalId)
      expect(found, canonicalId).toBeDefined()
      const channel = found?.channels.find((item) => item.channel === 'ark-plan')
      expect(channel?.id, canonicalId).toBe(expected.id)
      expect(channel?.source?.url, canonicalId).toContain(expected.source)
      expect(channel?.source?.checkedAt, canonicalId).toBe('2026-11-05')
    }
  })

  it('默认模型仍按量渠道选，套餐条目不单独标记默认', () => {
    // 声明的 default 是模型级标记；MCP 的默认从按量渠道（primaryChannel）里选。
    const image = selectDefaultModel(all, 'image.generate', 'ark')
    expect(image?.channel.channel).toBe('ark')
    expect(image?.declaration.canonicalId).toBe('volc/doubao-seedream-5-0-pro-260628')
    const video = selectDefaultModel(all, 'video.generate', 'ark')
    expect(video?.channel.channel).toBe('ark')
    expect(video?.declaration.canonicalId).toBe('volc/doubao-seedance-2-5-260628')
  })

  it('套餐模型目录接口返回的 ID 都能在声明的 ark-plan 渠道里找到', () => {
    // 接口返回的 ID 才是套餐接口真正接受的写法；声明必须与它一致。
    const recorded = fixture<RecordedCall>('plan-directory')
    const body = recorded.response.body as {
      Result?: { Datas?: Array<{ ModelID?: string }> }
    }
    const planIds = new Set(
      all.flatMap((item) => item.channels.filter((c) => c.channel === 'ark-plan').map((c) => c.id)),
    )
    const ids = (body.Result?.Datas ?? []).map((item) => item.ModelID ?? '')
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(planIds.has(id), id).toBe(true)
  })
})

describe('方舟套餐 TTS 的跨包复用', () => {
  // 豆包分块响应：一段音频 + 合成结束标记（code 20000000）
  const stream = '{"code":0,"data":"AQID"}{"code":20000000,"data":""}'

  it('静态复用 doubao-speech 的 synthesizeSpeech 并走 plan 专属端点', async () => {
    const { ctx, fetch } = fakeContext([new Response(stream, { status: 200 })], {
      secret: { ARK_AGENT_PLAN_API_KEY: 'test-key' },
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
      { secret: { ARK_AGENT_PLAN_API_KEY: 'test-key' } },
    )
    await expect(synthesizePlanSpeech({ text: '你好' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
