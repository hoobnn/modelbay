import { describe, expect, it } from 'vite-plus/test'
import {
  audit,
  type AuditInput,
  type DeclaredModel,
  guessCapability,
  isCandidateId,
  linkIds,
  productVersionId,
  stem,
  type LifecycleGap,
  type Snapshot,
} from './audit'
import { patchLifecycle } from './declarations'
import { dates, normalizeSnapshot, parseRows, plainText, tokens } from './markdown'
import { needsAttention, renderReport } from './report'
import { SOURCES } from './sources'

const TODAY = '2026-11-05'

function model(id: string, extra: Partial<DeclaredModel> = {}): DeclaredModel {
  return {
    canonicalId: `v/${id}`,
    id,
    title: id,
    capabilities: ['text.chat'],
    channels: [{ channel: 'c', id }],
    aliases: [],
    status: 'active',
    sources: [],
    ...extra,
  }
}

function run(snapshots: Snapshot[], declared: DeclaredModel[], extra: Partial<AuditInput> = {}) {
  return audit({ platform: 'p', today: TODAY, snapshots, declared, ...extra })
}

describe('markdown', () => {
  it('组件标签的 title 属性保留下来（百炼总览页的卡片）', () => {
    const card =
      '<Card title="qwen4-max-preview" icon="https://x/y.svg" href="/zh/model-studio/token-plan">'
    expect(tokens(card)).toEqual(['qwen4-max-preview'])
    expect(plainText('<span id="a1" /> 文本')).toBe('文本')
  })

  it('表格行带表头和标题路径，转义的竖线留在单元格里', () => {
    const rows = parseRows(
      [
        '# 一',
        '## 二',
        '',
        '| ID | 说明 |',
        '| --- | --- |',
        '| `a-1` \\| `a-2` | x |',
        '',
        '正文',
      ].join('\n'),
    )
    expect(rows[0]).toMatchObject({ header: ['ID', '说明'], line: 6 })
    expect(rows[0]!.cells[0]).toContain('a-2')
    expect(rows[0]!.path.map((heading) => heading.text)).toEqual(['一', '二'])
    expect(rows[1]).toMatchObject({ cells: ['正文'], header: [] })
  })

  it('代码块里的内容不算行，四个反引号的代码块里可以嵌三个反引号的', () => {
    expect(parseRows('```\n| a | b |\n```\n')).toEqual([])
    const nested = parseRows('````yaml\n```json\n{}\n```\nx\n````\n正文')
    expect(nested.map((row) => row.raw)).toEqual(['正文'])
  })

  it('plainText 去掉转义、链接地址和标签', () => {
    expect(plainText('**doubao\\-seed\\-2\\-0** [x](https://a.com/y)<br>z')).toBe(
      'doubao-seed-2-0 x z',
    )
  })

  it('tokens 拆出带斜杠的 ID 的各段', () => {
    expect(tokens('用 antdigital/Ling-2.5 或 gpt-6-luna。')).toEqual(
      expect.arrayContaining(['antdigital/Ling-2.5', 'Ling-2.5', 'gpt-6-luna']),
    )
  })

  it('dates 认多种写法，不把模型 ID 里的日期后缀当日期', () => {
    expect(dates('2026\\-9\\-24 10:00、2026年10月10日、January 14, 2027、Apr 1, 2027')).toEqual([
      '2026-09-24',
      '2026-10-10',
      '2027-01-14',
      '2027-04-01',
    ])
    expect(dates('qwen3-tts-flash-2025-09-18')).toEqual([])
    expect(dates('14 January 2027')).toEqual(['2027-01-14'])
  })

  it('normalizeSnapshot 去 BOM、行尾空白和多余空行', () => {
    expect(normalizeSnapshot('﻿a  \r\n\n\n\nb')).toBe('a\n\nb\n')
  })

  it('linkIds 取链接路径最后一段', () => {
    expect(
      linkIds('[GPT-6 Luna](/api/docs/models/gpt-6-luna.md) [x](https://a.com/m?name=q#h)'),
    ).toEqual(['gpt-6-luna', 'm'])
  })
})

describe('生命周期', () => {
  it('公告表格行带日期：未到期为 sunsetting，替代列里的模型不算', () => {
    const page: Snapshot = {
      url: 'https://x/dep',
      role: 'deprecation',
      markdown: [
        '| Shutdown date | Model | Recommended replacement |',
        '| --- | --- | --- |',
        '| Jan 6, 2027 | `old-1` | `new-2` |',
      ].join('\n'),
    }
    const gaps = run([page], [model('old-1'), model('new-2')])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      kind: 'lifecycle',
      canonicalId: 'v/old-1',
      proposed: { status: 'sunsetting', sunsetOn: '2027-01-06', source: 'https://x/dep' },
    })
  })

  it('行里没有日期时用同一批次里的日期，已过期为 retired', () => {
    const page: Snapshot = {
      url: 'https://x/dep',
      role: 'deprecation',
      markdown: [
        '# 第九批',
        '## 下线计划',
        '| 节点 | 时间 |',
        '| --- | --- |',
        '| EOS | 2026\\-9\\-21 |',
        '## 下线模型',
        '| 模型 ID | 建议迁移模型 |',
        '| --- | --- |',
        '| doubao\\-x\\-1 | doubao\\-y\\-2 |',
      ].join('\n'),
    }
    const gaps = run([page], [model('doubao-x-1'), model('doubao-y-2')])
    expect(gaps).toEqual([
      expect.objectContaining({
        canonicalId: 'v/doubao-x-1',
        proposed: { status: 'retired', source: 'https://x/dep' },
      }),
    ])
  })

  it('批次日期不含「注意」里单列给其他模型的日期', () => {
    const page: Snapshot = {
      url: 'https://x/dep',
      role: 'deprecation',
      markdown: [
        '# 第十批',
        '## 下线计划',
        '| 节点 | 时间 |',
        '| --- | --- |',
        '| EOS | **2026\\-11\\-24 14:00**<br><br>* doubao\\-z\\-1 模型的 EOS 时间：2027\\-01\\-22 |',
        '## 下线模型',
        '| 模型 ID | 建议迁移模型 |',
        '| --- | --- |',
        '| doubao\\-z\\-1 `EOS 时间：2027-01-22` | doubao\\-y\\-2 |',
        '| doubao\\-x\\-1 | doubao\\-y\\-2 |',
      ].join('\n'),
    }
    const gaps = run([page], [model('doubao-x-1'), model('doubao-y-2')], {
      today: '2026-11-25',
    })
    expect(gaps).toEqual([
      expect.objectContaining({
        canonicalId: 'v/doubao-x-1',
        proposed: { status: 'retired', source: 'https://x/dep' },
      }),
    ])
  })

  it('跟进的公告用链接所在小节的日期', () => {
    const page: Snapshot = {
      url: 'https://x/notice/1',
      role: 'deprecation',
      contextDates: ['2027-01-19'],
      markdown: '下线模型：qwen-a-1',
    }
    const [gap] = run([page], [model('qwen-a-1')]) as LifecycleGap[]
    expect(gap!.proposed).toMatchObject({ status: 'sunsetting', sunsetOn: '2027-01-19' })
  })

  it('历史模型一律归档成 retired，未声明的历史模型不报', () => {
    const page: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: [
        '## 当前模型',
        '| 模型名称 | 状态 |',
        '| --- | --- |',
        '| mx-3 | 可用 |',
        '| mx-8 | 可用 |',
        '## 历史模型',
        '| 模型名称 | 状态 |',
        '| --- | --- |',
        '| mx-1 | 已下线 |',
        '| mx-2 | 可用 |',
        '| mx-3 | 可用 |',
        '| mx-9 | 已下线 |',
        '| mx-0 | 已下线 |',
      ].join('\n'),
    }
    const gaps = run(
      [page],
      [
        model('mx-1', { status: 'sunsetting' }),
        model('mx-2'),
        model('mx-3'),
        model('mx-0', { status: 'retired' }),
      ],
    ) as LifecycleGap[]
    expect(gaps.map((gap) => [gap.kind, gap.canonicalId, gap.proposed?.status])).toEqual([
      ['lifecycle', 'v/mx-1', 'retired'],
      ['lifecycle', 'v/mx-2', 'retired'],
      ['undeclared', undefined, undefined],
    ])
    expect(gaps[2]).toMatchObject({ id: 'mx-8' })
    expect(gaps[0]!.proposed.source).toBe('https://x/list')
  })

  it('替代列里的模型和其他渠道仍在当前小节的模型不归档', () => {
    const history: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: [
        '## 历史模型',
        '| 模型 | 推荐替代 |',
        '| --- | --- |',
        '| mx-old | mx-new |',
        '| mx-shared | |',
      ].join('\n'),
    }
    const other: Snapshot = {
      url: 'https://x/plan',
      role: 'list',
      channel: 'd',
      markdown: '## 当前模型\n\n- mx-shared',
    }
    const shared = model('mx-shared', {
      channels: [
        { channel: 'c', id: 'mx-shared' },
        { channel: 'd', id: 'mx-shared' },
      ],
    })
    const gaps = run([history, other], [model('mx-old'), model('mx-new'), shared])
    expect(gaps.filter((gap) => gap.kind === 'lifecycle').map((gap) => gap.canonicalId)).toEqual([
      'v/mx-old',
    ])
  })

  it('共用声明有渠道没抓到列表页时不归档', () => {
    const history: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: '## 历史模型\n\n- mx-shared',
    }
    const shared = model('mx-shared', {
      channels: [
        { channel: 'c', id: 'mx-shared' },
        { channel: 'd', id: 'mx-shared' },
      ],
    })
    expect(run([history], [shared]).some((gap) => gap.kind === 'lifecycle')).toBe(false)
  })

  it('历史小节的归档覆盖公告推算的 sunsetting', () => {
    const notice: Snapshot = {
      url: 'https://x/dep',
      role: 'deprecation',
      markdown: '| 模型 | 下线日期 |\n| --- | --- |\n| m-1 | 2099-01-01 |',
    }
    const list: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: '## 历史模型\n\n- m-1',
    }
    const gaps = run([notice, list], [model('m-1')]) as LifecycleGap[]
    expect(gaps).toHaveLength(1)
    expect(gaps[0]!.proposed).toEqual({ status: 'retired', source: 'https://x/list' })
  })

  it('状态一致时不报', () => {
    const page: Snapshot = {
      url: 'https://x/dep',
      role: 'deprecation',
      markdown: '| Date | Model |\n| --- | --- |\n| Jan 6, 2027 | `a-1` |',
    }
    const sunsetting = model('a-1', { status: 'sunsetting', sunsetOn: '2027-01-06' })
    expect(run([page], [sunsetting])).toEqual([])
    expect(run([page], [model('a-1', { status: 'retired' })])).toEqual([])
  })
})

describe('列表对账', () => {
  const list: Snapshot = {
    url: 'https://x/list',
    role: 'list',
    channel: 'c',
    markdown: [
      '## 图片生成',
      '| 模型 | 说明 |',
      '| --- | --- |',
      '| doubao-img-2 | 新 |',
      '| doubao-img-1 | 旧 |',
      '| doubao-img-3 | 不接 |',
      '| [Doubao Img](https://x/detail?name=doubao-img-9) | 链接参数不算 |',
    ].join('\n'),
  }

  it('找出未声明的 ID、列表里找不到的声明，unlisted、skipped 和已下线的跳过', () => {
    const gaps = run(
      [list],
      [
        model('doubao-img-1'),
        model('doubao-gone-1'),
        model('doubao-custom'),
        model('doubao-old-1', { status: 'retired' }),
      ],
      { unlisted: ['doubao-custom'], skipped: ['Doubao-Img-3'] },
    )
    expect(gaps).toContainEqual(
      expect.objectContaining({
        kind: 'undeclared',
        id: 'doubao-img-2',
        capability: 'image.generate',
      }),
    )
    expect(gaps.filter((gap) => gap.kind === 'unlisted')).toEqual([
      expect.objectContaining({ canonicalId: 'v/doubao-gone-1', channel: 'c' }),
    ])
    expect(gaps.some((gap) => gap.kind === 'undeclared' && gap.id === 'doubao-img-9')).toBe(false)
    expect(gaps.some((gap) => gap.kind === 'undeclared' && gap.id === 'doubao-img-3')).toBe(false)
  })

  it('列表页漏列、但声明自己的来源页写着它的 ID，不算缺失；未声明的 ID 也算待处理', () => {
    const ref: Snapshot = {
      url: 'https://x/api',
      role: 'reference',
      markdown: '````yaml\nenum: [doubao-gone-1]\n````',
    }
    const gaps = run([list, ref], [model('doubao-gone-1', { sources: ['https://x/api'] })])
    expect(gaps.some((gap) => gap.kind === 'unlisted')).toBe(false)
    expect(needsAttention(gaps)).toBe(true)
    expect(needsAttention(gaps.filter((gap) => gap.kind !== 'undeclared'))).toBe(false)
    const elsewhere = run([list, ref], [model('doubao-gone-1')])
    expect(elsewhere).toContainEqual(expect.objectContaining({ kind: 'unlisted' }))
    expect(needsAttention(elsewhere)).toBe(true)
  })

  it('别名出现在列表里也算列出', () => {
    const gaps = run(
      [list],
      [model('x-1', { channels: [{ channel: 'c', id: 'x-1' }], aliases: ['doubao-img-1'] })],
    )
    expect(gaps.some((gap) => gap.kind === 'unlisted')).toBe(false)
  })

  it('候选 ID 规则：前缀、数字、连接符，平台全小写时排除显示名', () => {
    const prefixes = new Set(['gpt', 'qwen'])
    expect(isCandidateId('gpt-6-luna', prefixes)).toBe(true)
    expect(isCandidateId('GPT-6', prefixes)).toBe(true)
    expect(isCandidateId('GPT-6', prefixes, true)).toBe(false)
    expect(isCandidateId('qwen-image', prefixes)).toBe(false)
    expect(isCandidateId('gpt-6.md', prefixes)).toBe(false)
    expect(isCandidateId('other-1', prefixes)).toBe(false)
  })

  it('厂商前缀写法（百炼的「厂商/模型」）也算候选 ID', () => {
    const prefixes = new Set(['kimi'])
    expect(isCandidateId('kimi/kimi-k3', prefixes)).toBe(true)
    // 前缀按开头纯字母段取，所以 hyper3d 要用 hyper 匹配
    expect(isCandidateId('hyper3d-gen2-260112', new Set(['hyper']))).toBe(true)
    expect(isCandidateId('hyper3d-gen2-260112', new Set(['hyper3d']))).toBe(false)
  })

  it('能力先看行本身，再看小节标题', () => {
    const [row] = parseRows(
      '## 向量与重排\n| 模型 | 说明 |\n| --- | --- |\n| qwen3-rerank | 文本重排 |',
    )
    expect(guessCapability(row!)).toBe('native:rerank')
    const [embed] = parseRows(
      '## 向量与重排\n| 模型 | 说明 |\n| --- | --- |\n| text-embedding-v4 | 通用 |',
    )
    expect(guessCapability(embed!)).toBe('text.embed')
  })
})

describe('补丁与报告', () => {
  const gap: LifecycleGap = {
    kind: 'lifecycle',
    canonicalId: 'v/m-1',
    ids: ['m-1'],
    current: { status: 'active', source: 'https://x/old' },
    proposed: { status: 'sunsetting', sunsetOn: '2027-01-06', source: 'https://x/dep' },
    evidence: [
      {
        url: 'https://x/dep',
        section: 'Dep',
        quote: '| Jan 6, 2027 | m-1 |',
        dates: ['2027-01-06'],
      },
    ],
  }

  it('patchLifecycle 只替换 lifecycle 块，附原文引用', () => {
    const source = [
      'export default {',
      "  id: 'm-1',",
      '  lifecycle: {',
      "    status: 'active',",
      "    source: { url: 'https://x/old', checkedAt: '2026-01-01' },",
      '  },',
      "  source: { url: 'https://x/old', checkedAt: '2026-01-01' },",
      '}',
    ].join('\n')
    expect(patchLifecycle(source, gap, TODAY)).toBe(
      [
        'export default {',
        "  id: 'm-1',",
        '  // 官方原文（2026-11-05）：| Jan 6, 2027 | m-1 |',
        '  lifecycle: {',
        "    status: 'sunsetting',",
        "    sunsetOn: '2027-01-06',",
        "    source: { url: 'https://x/dep', checkedAt: '2026-11-05' },",
        '  },',
        "  source: { url: 'https://x/old', checkedAt: '2026-01-01' },",
        '}',
      ].join('\n'),
    )
    expect(() => patchLifecycle('export default {}', gap, TODAY)).toThrow('lifecycle')
  })

  it('报告列出各类差距和抓取失败', () => {
    const report = renderReport({
      platform: 'p',
      gaps: [gap],
      pages: [{ url: 'https://x/dep', role: 'deprecation', error: '超时' }],
      applied: [],
      skeletons: new Map(),
    })
    expect(report).toContain('`v/m-1`：active → sunsetting（2027-01-06）')
    expect(report).toContain('当前声明的依据：https://x/old')
    expect(report).toContain('**失败**：超时')
  })

  it('没有差距时说明都对得上；点名的 ID 附骨架', () => {
    const report = renderReport({
      platform: 'p',
      gaps: [],
      pages: [],
      applied: [],
      skeletons: new Map(),
    })
    expect(report).toContain('每个声明都能在官方文档里对上')
    const undeclared = renderReport({
      platform: 'p',
      gaps: [
        {
          kind: 'undeclared',
          channel: 'c',
          id: 'm-9',
          evidence: { url: 'https://x/l', section: 'S', quote: 'm-9', dates: [] },
        },
      ],
      pages: [],
      applied: [],
      skeletons: new Map([['c\nm-9', 'export default {}']]),
    })
    expect(undeclared).toContain('```ts\nexport default {}\n```')
    expect(undeclared).toContain('未声明的 ID（1 个）')
  })
})

// ── 审计盲区补齐（2026-11-14） ──────────

describe('候选 ID 的数字规则', () => {
  it('默认要求带版本号，平台配置的 digitless 前缀放行', () => {
    const prefixes = new Set(['gpt'])
    expect(isCandidateId('gpt-6-astra', prefixes)).toBe(true)
    expect(isCandidateId('gpt-transcribe', prefixes)).toBe(false)
    expect(isCandidateId('gpt-transcribe', prefixes, false, new Set(['gpt']))).toBe(true)
  })

  it('不带数字且没放行前缀的记号不算候选', () => {
    expect(isCandidateId('text-generation-model', new Set(['text']))).toBe(false)
    expect(
      isCandidateId('text-generation-model', new Set(['text']), false, new Set(['text'])),
    ).toBe(true)
  })

  it('审计里按 digitless 前缀把无版本号的模型报成未声明', () => {
    const list: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: '- [gpt-transcribe](/api/docs/models/gpt-transcribe.md)',
    }
    const without = run([list], [])
    expect(without).toHaveLength(0)
    const with_ = run([list], [], { prefixes: ['gpt'], digitless: ['gpt'] })
    expect(with_).toHaveLength(1)
    expect(with_[0]).toMatchObject({ kind: 'undeclared', id: 'gpt-transcribe' })
  })
})

describe('官方目录页写「产品名 + 版本」', () => {
  it('表头列名合成候选 ID', () => {
    expect(productVersionId('TTS 2.0')).toBe('tts-2.0')
    expect(productVersionId('Seed Audio 1.0')).toBe('seed-audio-1.0')
    expect(productVersionId('O2.0版本')).toBe('o-2.0')
    expect(productVersionId('全双工版本')).toBeUndefined()
    expect(productVersionId('模型名称')).toBeUndefined()
  })

  it('词干相同就当同一个模型（官方写产品名，声明写 API ID）', () => {
    expect(stem('seed-tts-2.0')).toBe('tts-2.0')
    expect(stem('tts-2.0')).toBe('2.0')
  })

  it('目录页只给产品名时，已声明的模型不报缺失也不报未声明', () => {
    const list: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: ['## 语音合成', '| 模型名称 | TTS 2.0 |', '| --- | --- |', '| 适用音色 | x |'].join(
        '\n',
      ),
    }
    const declared = model('seed-tts-2.0', { channels: [{ channel: 'c', id: 'seed-tts-2.0' }] })
    expect(run([list], [declared])).toEqual([])
  })

  it('目录页出现的新产品名报成未声明（用平台真实配置，不手填前缀）', () => {
    const list: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: [
        '## 语音合成',
        '| 模型名称 | TTS 3.0 | TTS 2.0 |',
        '| --- | --- | --- |',
        '| 适用音色 | x | y |',
      ].join('\n'),
    }
    const config = SOURCES.find((item) => item.key === 'doubao-speech')
    const declared = model('seed-tts-2.0', { channels: [{ channel: 'c', id: 'seed-tts-2.0' }] })
    const gaps = run([list], [declared], {
      ...(config?.prefixes ? { prefixes: config.prefixes } : {}),
    })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ kind: 'undeclared', id: 'tts-3.0' })
  })

  it('普通 ID 不做词干匹配：qwen4-max 已声明时，新出现的 qwen5-max 仍然报出', () => {
    const list: Snapshot = {
      url: 'https://x/list',
      role: 'list',
      channel: 'c',
      markdown: '## 文本生成\n\n- qwen4-max\n- qwen5-max',
    }
    const declared = model('qwen4-max', { channels: [{ channel: 'c', id: 'qwen4-max' }] })
    const gaps = run([list], [declared])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ kind: 'undeclared', id: 'qwen5-max' })
  })
})

describe('来源页抓取失败时不误报缺失', () => {
  const list: Snapshot = {
    url: 'https://x/list',
    role: 'list',
    channel: 'c',
    markdown: '## 其他\n\n- m-9',
  }
  const declared = model('m-1', {
    channels: [{ channel: 'c', id: 'm-1' }],
    sources: ['https://x/ref'],
  })
  it('来源页抓到了就正常判缺失', () => {
    // 来源页里写明了 m-1，算已列出
    const hit: Snapshot = { url: 'https://x/ref', role: 'reference', markdown: '- m-1' }
    expect(run([list, hit], [declared]).some((gap) => gap.kind === 'unlisted')).toBe(false)
    // 来源页里没有 m-1，报缺失
    const miss: Snapshot = { url: 'https://x/ref', role: 'reference', markdown: '- m-9' }
    expect(run([list, miss], [declared]).some((gap) => gap.kind === 'unlisted')).toBe(true)
  })
  it('来源页抓取失败就不报这一类差距', () => {
    const gaps = run([list], [declared], { failedUrls: ['https://x/ref'] })
    expect(gaps.some((gap) => gap.kind === 'unlisted')).toBe(false)
  })
})
