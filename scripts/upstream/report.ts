/** 把对账结果渲染成 Markdown 报告（用作跟踪 issue 和草稿 PR 的正文，不进仓库）。 */
import type { Gap, LifecycleGap, UndeclaredGap, UnlistedGap } from './audit'

export interface PageStatus {
  url: string
  role: string
  method?: string
  file?: string
  error?: string
}

export interface ReportInput {
  platform: string
  gaps: Gap[]
  pages: PageStatus[]
  /** 已写进声明文件的生命周期补丁。 */
  applied: string[]
  /** 用 --skeleton 点名的未声明模型的骨架：`渠道\nid` → TS 源码。 */
  skeletons: Map<string, string>
}

function clip(line: string): string {
  const flat = line.replace(/\s+/g, ' ')
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

function lifecycleSection(gaps: LifecycleGap[], applied: string[]): string[] {
  if (gaps.length === 0) return []
  const out = ['### 生命周期待更新', '']
  out.push(
    applied.length > 0
      ? '补丁已写进声明文件，合并前逐条对照原文核对日期和状态。'
      : '用 `--apply` 运行会把下面的补丁写进声明文件。',
    '',
    '官方列表放在历史 / 已下线小节的模型一律归档为 `retired`，不再支持。',
    '',
  )
  for (const gap of gaps) {
    const from = gap.current.sunsetOn
      ? `${gap.current.status}（${gap.current.sunsetOn}）`
      : gap.current.status
    const to = gap.proposed.sunsetOn
      ? `${gap.proposed.status}（${gap.proposed.sunsetOn}）`
      : gap.proposed.status
    out.push(`#### \`${gap.canonicalId}\`：${from} → ${to}`, '')
    out.push(`- 点名的 ID：${gap.ids.map((id) => `\`${id}\``).join('、')}`)
    if (gap.current.source) out.push(`- 当前声明的依据：${gap.current.source}`)
    for (const evidence of gap.evidence.slice(0, 3)) {
      const when = evidence.dates.length > 0 ? `，日期 ${evidence.dates.join(' / ')}` : ''
      out.push(`- [${evidence.section || evidence.url}](${evidence.url})${when}`)
      out.push(`  > ${clip(evidence.quote)}`)
    }
    out.push('')
  }
  return out
}

function unlistedSection(gaps: UnlistedGap[]): string[] {
  if (gaps.length === 0) return []
  const out = ['### 官方列表和来源页里都找不到', '']
  out.push(
    '渠道内 ID 和别名既不在该渠道的列表页里，也不在声明自己引用的来源页里。可能已下线、改名，或 ID 写错了。核对后改声明；本来就不会出现在官方文档里的 ID 加进 `scripts/upstream/sources.ts` 的 `unlisted`。',
    '',
  )
  out.push('| 声明 | 渠道 | 渠道内 ID | 查过的列表页 |', '| --- | --- | --- | --- |')
  for (const gap of gaps) {
    const pages = gap.pages.map((url, index) => `[${index + 1}](${url})`).join(' ')
    out.push(`| \`${gap.canonicalId}\` | ${gap.channel} | \`${gap.id}\` | ${pages} |`)
  }
  out.push('')
  return out
}

function undeclaredSection(gaps: UndeclaredGap[], skeletons: Map<string, string>): string[] {
  if (gaps.length === 0) return []
  const out = ['## 官方 → 声明', '']
  out.push(
    `官方列表页上有 ${gaps.length} 个模型 ID 没有声明。要支持哪个，用 \`--skeleton <id>\` 重跑生成声明骨架，照原文补齐能力、上下限和默认值。`,
    '',
  )
  for (const gap of gaps) {
    const code = skeletons.get(`${gap.channel}\n${gap.id}`)
    if (!code) continue
    out.push(`### \`${gap.id}\`（${gap.channel}）`, '')
    out.push(`- 出处：[${gap.evidence.section || gap.evidence.url}](${gap.evidence.url})`)
    out.push(`  > ${clip(gap.evidence.quote)}`, '')
    out.push('```ts', code.trimEnd(), '```', '')
  }
  out.push('<details>', `<summary>未声明的 ID（${gaps.length} 个）</summary>`, '')
  out.push('| 渠道 | ID | 猜测能力 | 小节 |', '| --- | --- | --- | --- |')
  for (const gap of gaps) {
    out.push(
      `| ${gap.channel} | \`${gap.id}\` | ${gap.capability ?? ''} | ${escapeCell(gap.evidence.section)} |`,
    )
  }
  out.push('', '</details>', '')
  return out
}

function pagesSection(pages: PageStatus[]): string[] {
  const out = ['## 抓取情况', '', '| 页面 | 角色 | 方式 |', '| --- | --- | --- |']
  for (const page of pages) {
    const how = page.error ? `**失败**：${escapeCell(page.error)}` : (page.method ?? '')
    out.push(`| ${page.url} | ${page.role} | ${how} |`)
  }
  out.push('')
  return out
}

/** 声明这一侧有没有需要人处理的差距（决定跟踪 issue 开着还是关掉）。未声明的模型只列出，不算。 */
export function needsAttention(gaps: Gap[]): boolean {
  return gaps.some((gap) => gap.kind !== 'undeclared')
}

export function renderReport(input: ReportInput): string {
  const by = <K extends Gap['kind']>(kind: K) =>
    input.gaps.filter((gap): gap is Extract<Gap, { kind: K }> => gap.kind === kind)
  const lifecycle = by('lifecycle')
  const unlisted = by('unlisted')
  const undeclared = by('undeclared')
  const failed = input.pages.filter((page) => page.error)

  const out = [`# 上游文档对账：${input.platform}`, '']
  out.push(
    '由 `pnpm upstream:audit` 生成：现抓官方文档，抽取模型清单和下线信息，与声明双向核对。',
    '',
    '| 项 | 数量 |',
    '| --- | --- |',
    `| 生命周期待更新 | ${lifecycle.length} |`,
    `| 官方列表和来源页里都找不到 | ${unlisted.length} |`,
    `| 官方有、尚未声明 | ${undeclared.length} |`,
    `| 抓取失败 | ${failed.length} |`,
    '',
  )
  out.push('## 声明 → 官方', '')
  if (!needsAttention(input.gaps)) out.push('每个声明都能在官方文档里对上。', '')
  out.push(
    ...lifecycleSection(lifecycle, input.applied),
    ...unlistedSection(unlisted),
    ...undeclaredSection(undeclared, input.skeletons),
    ...pagesSection(input.pages),
  )
  return `${out.join('\n').trimEnd()}\n`
}
