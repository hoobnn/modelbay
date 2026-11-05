import { describe, expect, it } from 'vite-plus/test'
import {
  LIFECYCLE_STATUSES,
  isSelectable,
  canBeDefault,
  lifecycleNotice,
  validateDeclaration,
  resolveModel,
  customModel,
  defaultConflicts,
  selectDefaultModel,
  toModelInfo,
  ModelRegistry,
} from './declarations'
import type { ModelDeclaration, ChannelRef, Lifecycle, LifecycleStatus } from './declarations'

const source = { url: 'https://platform.example.com/docs', checkedAt: '2026-11-04' }

const base = (): ModelDeclaration => ({
  canonicalId: 'minimax/speech-2.8-hd',
  id: 'speech-2.8-hd',
  title: 'MiniMax Speech 2.8 HD',
  capabilities: ['audio.speech'],
  channels: [
    { channel: 'minimax', id: 'speech-2.8-hd' },
    { channel: 'bailian', id: 'MiniMax/speech-2.8-hd' },
  ],
  aliases: { official: ['speech-2.8-hd-live'], short: ['hd'] },
  lifecycle: { status: 'active', source },
  source,
})

const patch = (overrides: Partial<ModelDeclaration>): ModelDeclaration => ({
  ...base(),
  ...overrides,
})

describe('validateDeclaration', () => {
  it('合法声明没有问题，生命周期状态是固定五类', () => {
    expect(validateDeclaration(base())).toEqual([])
    expect(LIFECYCLE_STATUSES).toEqual([
      'active',
      'superseded',
      'sunsetting',
      'closed-to-new-accounts',
      'retired',
    ])
  })

  it('缺 canonicalId 斜杠、缺 title、无能力、无渠道都报问题', () => {
    expect(validateDeclaration(patch({ canonicalId: 'nope' }))).toContain(
      'canonicalId 应为 厂商/模型',
    )
    expect(validateDeclaration(patch({ title: '' }))).toContain('缺少 title')
    expect(validateDeclaration(patch({ capabilities: [] }))).toContain('没有声明能力')
    expect(validateDeclaration(patch({ channels: [] }))).toContain('至少要有一个渠道')
  })

  it('source 必须是 https 链接且 checkedAt 为 YYYY-MM-DD', () => {
    expect(
      validateDeclaration(patch({ source: { url: 'http://x', checkedAt: '2026-11-04' } })),
    ).toContain('source.url 缺失或不是 https 链接')
    expect(
      validateDeclaration(patch({ source: { url: 'https://x', checkedAt: '2026-1-4' } })),
    ).toContain('source.checkedAt 应为 YYYY-MM-DD')
    expect(validateDeclaration(patch({ source: { url: 'https://x', checkedAt: '' } }))).toContain(
      'source.checkedAt 应为 YYYY-MM-DD',
    )
  })

  it('lifecycle 的来源与日期也要合法', () => {
    const badSource: Lifecycle = { status: 'active', source: { url: '', checkedAt: 'bad' } }
    const problems = validateDeclaration(patch({ lifecycle: badSource }))
    expect(problems).toContain('lifecycle.source.url 缺失')
    expect(problems).toContain('lifecycle.source.checkedAt 应为 YYYY-MM-DD')
  })

  it('生命周期状态未知或 superseded 缺 by 都报问题', () => {
    const unknown = { status: 'mystery', source } as unknown as Lifecycle
    expect(validateDeclaration(patch({ lifecycle: unknown }))).toContain('未知的生命周期状态')
    const superseded: Lifecycle = { status: 'superseded', source }
    expect(validateDeclaration(patch({ lifecycle: superseded }))).toContain(
      'superseded 需要记录 by',
    )
    const withBy: Lifecycle = { status: 'superseded', by: 'minimax/speech-3', source }
    expect(validateDeclaration(patch({ lifecycle: withBy }))).toEqual([])
  })

  it('渠道缺 channel 或 id 报问题', () => {
    expect(validateDeclaration(patch({ channels: [{ channel: '', id: 'x' }] }))).toContain(
      '渠道缺少 channel 或 id',
    )
    expect(validateDeclaration(patch({ channels: [{ channel: 'minimax', id: '' }] }))).toContain(
      '渠道缺少 channel 或 id',
    )
  })

  it('lifecycle 整体缺失时多项都报', () => {
    const problems = validateDeclaration(patch({ lifecycle: undefined as unknown as Lifecycle }))
    expect(problems).toContain('lifecycle.source.url 缺失')
    expect(problems).toContain('lifecycle.source.checkedAt 应为 YYYY-MM-DD')
    expect(problems).toContain('未知的生命周期状态')
  })
})

describe('isSelectable / canBeDefault', () => {
  const status = (s: LifecycleStatus): ModelDeclaration =>
    patch({ lifecycle: { status: s, source } })

  it('retired 不可选，其余都可选', () => {
    expect(isSelectable(status('retired'))).toBe(false)
    for (const s of ['active', 'superseded', 'sunsetting', 'closed-to-new-accounts'] as const) {
      expect(isSelectable(status(s))).toBe(true)
    }
  })

  it('只有 active 能当默认', () => {
    expect(canBeDefault(status('active'))).toBe(true)
    for (const s of ['superseded', 'sunsetting', 'closed-to-new-accounts', 'retired'] as const) {
      expect(canBeDefault(status(s))).toBe(false)
    }
  })
})

describe('lifecycleNotice', () => {
  const notice = (lifecycle: Lifecycle): string | null => lifecycleNotice(patch({ lifecycle }))

  it('active 返回 null', () => {
    expect(notice({ status: 'active', source })).toBeNull()
  })

  it('superseded 带 by 与不带 by', () => {
    expect(notice({ status: 'superseded', by: 'minimax/speech-3', source })).toBe(
      '官方已推荐更新的型号 minimax/speech-3',
    )
    expect(notice({ status: 'superseded', source })).toBe('官方已推荐更新的型号')
  })

  it('sunsetting 带日期与不带日期', () => {
    expect(notice({ status: 'sunsetting', sunsetOn: '2026-11-24', source })).toBe(
      '官方已宣布 2026-11-24 下线',
    )
    expect(notice({ status: 'sunsetting', source })).toBe('官方已宣布即将下线')
  })

  it('closed-to-new-accounts 带日期与不带日期', () => {
    expect(notice({ status: 'closed-to-new-accounts', since: '2026-08-20', source })).toBe(
      '自 2026-08-20 起不再向新账号开放',
    )
    expect(notice({ status: 'closed-to-new-accounts', source })).toBe('不再向新账号开放')
  })

  it('retired 与未知状态', () => {
    expect(notice({ status: 'retired', source })).toBe('官方已下线，旧引用可以打开但不能运行')
    expect(notice({ status: 'mystery', source } as unknown as Lifecycle)).toBeNull()
  })
})

describe('resolveModel', () => {
  const declarations = [base()]

  it('按 渠道:渠道内ID 解析', () => {
    expect(resolveModel(declarations, 'minimax:speech-2.8-hd')).toMatchObject({
      channel: { channel: 'minimax', id: 'speech-2.8-hd' },
    })
    expect(resolveModel(declarations, 'bailian:MiniMax/speech-2.8-hd')).toMatchObject({
      channel: { channel: 'bailian', id: 'MiniMax/speech-2.8-hd' },
    })
  })

  it('按规范 ID / 官方别名 / 简称解析，返回首个渠道', () => {
    for (const ref of ['minimax/speech-2.8-hd', 'speech-2.8-hd-live', 'hd']) {
      expect(resolveModel(declarations, ref)).toMatchObject({ channel: { channel: 'minimax' } })
    }
  })

  it('渠道不匹配或 ID 不存在时返回 null', () => {
    expect(resolveModel(declarations, 'ark:speech-2.8-hd')).toBeNull()
    expect(resolveModel(declarations, 'minimax:unknown')).toBeNull()
    expect(resolveModel([], 'minimax:speech-2.8-hd')).toBeNull()
  })
})

describe('customModel / selectDefaultModel', () => {
  it('customModel 把能力与自定义 ID 拼成 custom 字符串', () => {
    expect(customModel('foo', 'text.chat')).toEqual({ custom: 'text.chat:foo' })
    expect(customModel('bar', 'voice.clone')).toEqual({ custom: 'voice.clone:bar' })
  })

  const retired = patch({
    canonicalId: 'x/retired',
    channels: [{ channel: 'minimax', id: 'old' }],
    lifecycle: { status: 'retired', source },
  })
  const imageModel = patch({
    canonicalId: 'x/image',
    capabilities: ['image.generate'],
    channels: [{ channel: 'minimax', id: 'image-1' }],
  })
  const list = [retired, patch({ default: true }), imageModel]

  it('只选标了 default 且 active、具备该能力的模型', () => {
    expect(selectDefaultModel(list, 'audio.speech')).toMatchObject({
      declaration: { canonicalId: 'minimax/speech-2.8-hd' },
      channel: { channel: 'minimax' },
    })
    expect(selectDefaultModel(list, 'video.generate')).toBeNull()
  })

  it('没有 default 标记就没有默认模型，不再按声明顺序兜底', () => {
    expect(selectDefaultModel([base()], 'audio.speech')).toBeNull()
    expect(selectDefaultModel(list, 'image.generate')).toBeNull()
  })

  it('非 active 的默认标记不生效', () => {
    const retiredDefault = patch({
      default: true,
      lifecycle: { status: 'retired', source },
    })
    expect(selectDefaultModel([retiredDefault], 'audio.speech')).toBeNull()
  })

  it('defaultConflicts 找出同一渠道同一能力的重复默认', () => {
    const single = patch({
      default: true,
      channels: [{ channel: 'minimax', id: 'speech-2.8-hd' }],
    })
    const other = patch({
      canonicalId: 'minimax/speech-2.8-turbo',
      channels: [{ channel: 'minimax', id: 'speech-2.8-turbo' }],
      default: true,
    })
    expect(defaultConflicts([single, other])).toHaveLength(1)
    expect(defaultConflicts([single])).toEqual([])
  })

  it('按渠道筛选', () => {
    expect(selectDefaultModel(list, 'audio.speech', 'bailian')).toMatchObject({
      channel: { channel: 'bailian' },
    })
    expect(selectDefaultModel(list, 'audio.speech', 'ark')).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(selectDefaultModel([], 'audio.speech')).toBeNull()
  })
})

describe('toModelInfo', () => {
  const rich = (): ModelDeclaration => ({
    ...base(),
    description: '描述',
    features: ['tools'],
    limits: { promptMaxLength: 100, duration: { min: 1, max: 5 } },
    voices: [{ id: 'v1', title: 'V1', gender: 'female' }],
    optionsSchema: { type: 'object', properties: { foo: { type: 'string' } } },
    capabilities: ['audio.speech', 'voice.clone'],
  })

  it('派生出 legacy 能力、渠道 id 与各可选字段', () => {
    const info = toModelInfo(rich())
    expect(info.id).toBe('speech-2.8-hd')
    expect(info.title).toBe('MiniMax Speech 2.8 HD')
    expect(info.capabilities).toEqual(['audio.speech'])
    expect(info.description).toBe('描述')
    expect(info.features).toEqual(['tools'])
    expect(info.limits).toEqual({ promptMaxLength: 100, duration: { min: 1, max: 5 } })
    expect(info.voices).toEqual([{ id: 'v1', title: 'V1', gender: 'female' }])
    expect(info.optionsSchema).toEqual({
      type: 'object',
      properties: { foo: { type: 'string' } },
    })
    expect(info.deprecated).toBeUndefined()
  })

  it('指定渠道时用渠道 id 与渠道 limits 覆盖', () => {
    const channel: ChannelRef = {
      channel: 'bailian',
      id: 'MiniMax/speech-2.8-hd',
      limits: { promptMaxLength: 999 },
    }
    const info = toModelInfo(rich(), channel)
    expect(info.id).toBe('MiniMax/speech-2.8-hd')
    expect(info.limits).toEqual({ promptMaxLength: 999, duration: { min: 1, max: 5 } })
  })

  it('没有渠道时回退到 canonicalId，省略所有可选字段', () => {
    const info = toModelInfo(patch({ channels: [] }))
    expect(info.id).toBe('minimax/speech-2.8-hd')
    expect(info.description).toBeUndefined()
    expect(info.features).toBeUndefined()
    expect(info.limits).toBeUndefined()
    expect(info.voices).toBeUndefined()
    expect(info.optionsSchema).toBeUndefined()
  })

  it('retired 模型带 deprecated 标记', () => {
    const retired = patch({ lifecycle: { status: 'retired', source } })
    expect(toModelInfo(retired).deprecated).toBe(true)
  })

  it('停止新购与宣布下线的模型保留 plein 的弃用标记，superseded 不算', () => {
    const closed = patch({
      lifecycle: { status: 'closed-to-new-accounts', since: '2026-08-20', source },
    })
    const sunsetting = patch({
      lifecycle: { status: 'sunsetting', sunsetOn: '2026-11-24', source },
    })
    const superseded = patch({ lifecycle: { status: 'superseded', by: 'x-2', source } })
    expect(toModelInfo(closed).deprecated).toBe(true)
    expect(toModelInfo(sunsetting).deprecated).toBe(true)
    expect(toModelInfo(superseded).deprecated).toBeUndefined()
    expect(toModelInfo(base()).deprecated).toBeUndefined()
  })

  it('渠道级 agentOnly 与 omitOptions 只作用于该渠道', () => {
    const declaration = patch({
      optionsSchema: {
        type: 'object',
        properties: { draft: { type: 'boolean' }, seed: { type: 'number' } },
        required: ['draft', 'seed'],
      },
      channels: [
        { channel: 'minimax', id: 'a' },
        { channel: 'bailian', id: 'b', agentOnly: true, omitOptions: ['draft'] },
      ],
    })
    const [open, restricted] = declaration.channels
    const plain = toModelInfo(declaration, open)
    expect(plain.agentOnly).toBeUndefined()
    expect(Object.keys((plain.optionsSchema as { properties: object }).properties)).toEqual([
      'draft',
      'seed',
    ])
    const scoped = toModelInfo(declaration, restricted)
    expect(scoped.agentOnly).toBe(true)
    expect(scoped.optionsSchema).toEqual({
      type: 'object',
      properties: { seed: { type: 'number' } },
      required: ['seed'],
    })
    expect(toModelInfo(patch({ agentOnly: true }), open).agentOnly).toBe(true)
  })
})

describe('ModelRegistry', () => {
  const a = base()
  const imageModel = patch({
    canonicalId: 'minimax/image-1',
    capabilities: ['image.generate'],
    channels: [{ channel: 'minimax', id: 'image-1' }],
    aliases: { short: ['img'] },
  })
  const retired = patch({
    canonicalId: 'minimax/old',
    channels: [{ channel: 'minimax', id: 'old' }],
    aliases: { short: ['old'] },
    lifecycle: { status: 'retired', source },
  })
  const registry = (): ModelRegistry =>
    new ModelRegistry().add(patch({ default: true }), imageModel, retired)

  it('add 可链式、校验非法声明并抛错', () => {
    const reg = new ModelRegistry()
    expect(reg.add(a)).toBe(reg)
    expect(reg.all()).toHaveLength(1)
    expect(() => new ModelRegistry().add(patch({ title: '' }))).toThrow(/不合法/)
  })

  it('all 返回全部声明', () => {
    expect(registry().all()).toHaveLength(3)
  })

  it('resolve / defaultFor 委托给对应函数', () => {
    const reg = registry()
    expect(reg.resolve('minimax:speech-2.8-hd')).toMatchObject({
      channel: { channel: 'minimax' },
    })
    expect(reg.defaultFor('audio.speech')).toMatchObject({
      declaration: { canonicalId: 'minimax/speech-2.8-hd' },
    })
    expect(reg.defaultFor('audio.speech', 'ark')).toBeNull()
  })

  it('list 按能力与渠道过滤', () => {
    const reg = registry()
    expect(reg.list()).toHaveLength(3)
    expect(reg.list('audio.speech')).toHaveLength(2)
    expect(reg.list('audio.speech', 'bailian')).toHaveLength(1)
    expect(reg.list('video.generate')).toHaveLength(0)
    expect(reg.list(undefined, 'bailian')).toHaveLength(1)
  })

  it('aliasConflicts 找出指向不同规范 ID 的重复别名', () => {
    const dup1 = patch({ canonicalId: 'x/one', aliases: { short: ['dup'] } })
    const dup2 = patch({ canonicalId: 'x/two', aliases: { short: ['dup'] } })
    expect(new ModelRegistry().add(dup1, dup2).aliasConflicts()).toEqual(['dup'])
  })

  it('同一规范 ID 重复别名不算冲突，空注册表无冲突', () => {
    const dup = patch({ canonicalId: 'x/one', aliases: { official: ['dup'], short: ['dup'] } })
    expect(new ModelRegistry().add(dup).aliasConflicts()).toEqual([])
    expect(new ModelRegistry().aliasConflicts()).toEqual([])
  })
})
