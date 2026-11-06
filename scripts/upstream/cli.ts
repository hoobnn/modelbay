/**
 * 上游文档对账的命令行入口。
 *
 *   vpx -s scripts/upstream/cli.ts coverage
 *     离线：检查每个声明的来源都是白名单里的官方 https 地址并带核对日期（pnpm verify 会跑）。
 *
 *   vpx -s scripts/upstream/cli.ts audit [--platform <key>]... [--apply] [--offline]
 *                                        [--skeleton <id>]... [--today YYYY-MM-DD]
 *     抓取官方文档 → 抽取 → 和声明双向核对 → 报告写到 .upstream-docs/<平台>/report.md。
 *     --apply     把生命周期补丁写进声明文件
 *     --offline   不联网，用 .upstream-docs/ 里上一次抓到的全文重新对账（调试抽取规则用）
 *     --skeleton  给这些未声明的 ID 生成声明骨架，附在报告里
 *
 * 仓库里不存任何官方文档内容，也不存上一次的结果：每次都拿现抓的原文和声明核对。
 * 抓到的全文和报告只写到不进仓库的 .upstream-docs/<平台>/，供本地查看和 CI artifact。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { audit, type Gap, type LifecycleGap, type PageRole, type Snapshot } from './audit'
import {
  applyLifecycle,
  coverageProblems,
  defaultVendor,
  loadDeclarations,
  platformKeys,
  ROOT,
  skeleton,
  toDeclared,
} from './declarations'
import { closeRenderer, fetchPage, linksIn } from './fetch'
import { dates, normalizeSnapshot, parseRows } from './markdown'
import { needsAttention, type PageStatus, renderReport } from './report'
import { isOfficialUrl, type PlatformSources, SOURCES } from './sources'

interface PageEntry {
  url: string
  role: PageRole
  channel?: string
  contextDates?: string[]
  method?: string
}

const CACHE_DIR = join(ROOT, '.upstream-docs')

function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function slug(url: string): string {
  const parsed = new URL(url)
  const name = `${parsed.hostname}${parsed.pathname}${parsed.search}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${name}.md`
}

function platformDir(platform: string): string {
  return join(CACHE_DIR, platform)
}

function pagesDir(platform: string): string {
  return join(platformDir(platform), 'pages')
}

const indexPath = (platform: string) => join(platformDir(platform), 'pages.json')

function sourcesOf(platform: string): PlatformSources {
  return SOURCES.find((item) => item.key === platform) ?? { key: platform, pages: [] }
}

/** 目录页 + 声明里引用的其他来源页。 */
function plannedPages(platform: string, declaredSources: string[]): PageEntry[] {
  const config = sourcesOf(platform)
  const pages: PageEntry[] = config.pages.map((page) => ({
    url: page.url,
    role: page.role,
    ...(page.channel ? { channel: page.channel } : {}),
  }))
  const known = new Set(pages.map((page) => page.url))
  for (const url of [...new Set(declaredSources)].sort()) {
    if (!known.has(url)) pages.push({ url, role: 'reference' })
  }
  return pages
}

/** 公告索引页里链到的详情页，带上链接所在小节标题里的日期。 */
function followed(platform: string, entry: PageEntry, markdown: string): PageEntry[] {
  const pattern = sourcesOf(platform).pages.find((page) => page.url === entry.url)?.follow
  if (!pattern) return []
  const found = new Map<string, PageEntry>()
  for (const row of parseRows(markdown)) {
    for (const url of linksIn(row.raw)) {
      if (!pattern.test(url) || found.has(url) || !isOfficialUrl(url)) continue
      const contextDates = dates(row.path.map((heading) => heading.text).join(' '))
      found.set(url, { url, role: 'deprecation', ...(contextDates.length ? { contextDates } : {}) })
    }
  }
  return [...found.values()]
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

interface Fetched {
  entry: PageEntry
  markdown?: string
  error?: string
}

async function fetchAll(platform: string, planned: PageEntry[]): Promise<Fetched[]> {
  const run = (entry: PageEntry) =>
    fetchPage(entry.url).then(
      (page): Fetched => ({
        entry: { ...entry, method: page.method },
        markdown: normalizeSnapshot(page.markdown),
      }),
      (error: unknown): Fetched => ({
        entry,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  const first = await mapLimit(planned, 4, run)
  const extra = first.flatMap((item) =>
    item.markdown ? followed(platform, item.entry, item.markdown) : [],
  )
  // 跟进到的公告如果也是某个声明的来源页，按公告处理（带上下文日期）
  const byUrl = new Map(first.map((item) => [item.entry.url, item]))
  const fresh: PageEntry[] = []
  for (const entry of extra) {
    const existing = byUrl.get(entry.url)
    if (existing) existing.entry = { ...existing.entry, ...entry, method: existing.entry.method }
    else if (!fresh.some((item) => item.url === entry.url)) fresh.push(entry)
  }
  const second = await mapLimit(fresh, 2, run)
  return [...first, ...second]
}

interface PageText extends PageEntry {
  markdown: string
}

/**
 * 把本次抓到的全文写到 .upstream-docs/（覆盖上一次），返回参与对账的页面。
 * 某个渠道的列表页有一页没抓到，就整个渠道不做列表核对，免得把漏抓当成「官方没列」。
 */
function collectPages(platform: string, fetched: Fetched[]): PageText[] {
  rmSync(pagesDir(platform), { recursive: true, force: true })
  mkdirSync(pagesDir(platform), { recursive: true })
  const brokenChannels = new Set(
    fetched.flatMap((item) =>
      item.markdown === undefined && item.entry.role === 'list' && item.entry.channel
        ? [item.entry.channel]
        : [],
    ),
  )
  const pages: PageText[] = []
  for (const item of fetched) {
    if (item.markdown === undefined) continue
    writeFileSync(join(pagesDir(platform), slug(item.entry.url)), item.markdown)
    if (item.entry.role === 'list' && brokenChannels.has(item.entry.channel ?? '')) continue
    pages.push({ ...item.entry, markdown: item.markdown })
  }
  const index = pages.map(({ markdown: _, ...entry }) => entry)
  writeFileSync(indexPath(platform), `${JSON.stringify(index, null, 2)}\n`)
  return pages
}

function readPages(platform: string): PageText[] {
  if (!existsSync(indexPath(platform))) return []
  const index = JSON.parse(readFileSync(indexPath(platform), 'utf8')) as PageEntry[]
  return index.flatMap((entry) => {
    const path = join(pagesDir(platform), slug(entry.url))
    return existsSync(path) ? [{ ...entry, markdown: readFileSync(path, 'utf8') }] : []
  })
}

function toSnapshot(page: PageText): Snapshot {
  return {
    url: page.url,
    role: page.role,
    ...(page.channel ? { channel: page.channel } : {}),
    ...(page.contextDates ? { contextDates: page.contextDates } : {}),
    markdown: page.markdown,
  }
}

interface AuditResult {
  platform: string
  gaps: Gap[]
  errors: number
  attention: boolean
}

async function auditPlatform(
  platform: string,
  options: { apply: boolean; offline: boolean; today: string; skeletons: string[] },
): Promise<AuditResult> {
  const declarations = loadDeclarations(platform)
  const declared = declarations.map(toDeclared)

  let texts: PageText[]
  let pages: PageStatus[]
  if (options.offline) {
    texts = readPages(platform)
    pages = texts.map((entry) => ({ url: entry.url, role: entry.role, method: 'offline' }))
  } else {
    const planned = plannedPages(
      platform,
      declared.flatMap((model) => model.sources),
    )
    const fetched = await fetchAll(platform, planned)
    texts = collectPages(platform, fetched)
    pages = fetched.map((item) => ({
      url: item.entry.url,
      role: item.entry.role,
      ...(item.entry.method ? { method: item.entry.method } : {}),
      ...(item.error ? { error: item.error } : {}),
    }))
  }

  const config = sourcesOf(platform)
  const gaps = audit({
    platform,
    today: options.today,
    snapshots: texts.map(toSnapshot),
    declared,
    ...(config.prefixes ? { prefixes: config.prefixes } : {}),
    ...(config.excludePrefixes ? { excludePrefixes: config.excludePrefixes } : {}),
    ...(config.unlisted ? { unlisted: config.unlisted } : {}),
  })

  const applied: string[] = []
  if (options.apply) {
    for (const gap of gaps.filter((item): item is LifecycleGap => item.kind === 'lifecycle')) {
      applied.push(relative(ROOT, applyLifecycle(platform, gap, options.today)))
    }
  }
  const vendor = defaultVendor(declarations)
  const wanted = new Set(options.skeletons.map((id) => id.toLowerCase()))
  const skeletons = new Map<string, string>()
  for (const gap of gaps) {
    if (gap.kind === 'undeclared' && wanted.has(gap.id.toLowerCase())) {
      skeletons.set(`${gap.channel}\n${gap.id}`, skeleton(gap, vendor, options.today))
    }
  }

  const report = renderReport({ platform, gaps, pages, applied, skeletons })
  mkdirSync(platformDir(platform), { recursive: true })
  writeFileSync(join(platformDir(platform), 'report.md'), report)

  const errors = pages.filter((page) => page.error).length
  return { platform, gaps, errors, attention: needsAttention(gaps) }
}

function parseFlags(argv: string[]) {
  const platforms: string[] = []
  const skeletons: string[] = []
  let apply = false
  let offline = false
  let date = today()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--apply') apply = true
    else if (flag === '--offline') offline = true
    else if (flag === '--platform') platforms.push(argv[(index += 1)] ?? '')
    else if (flag === '--skeleton') skeletons.push(argv[(index += 1)] ?? '')
    else if (flag === '--today') date = argv[(index += 1)] ?? ''
    else throw new Error(`未知参数：${flag}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--today 应为 YYYY-MM-DD')
  const keys = platformKeys()
  for (const key of platforms) {
    if (!keys.includes(key)) throw new Error(`未知平台：${key}（可选 ${keys.join('、')}）`)
  }
  return {
    platforms: platforms.length > 0 ? platforms : keys,
    apply,
    offline,
    skeletons,
    today: date,
  }
}

function githubOutput(values: Record<string, string>) {
  const path = process.env.GITHUB_OUTPUT
  if (!path) return
  appendFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'coverage') {
    const problems = platformKeys().flatMap((key) =>
      coverageProblems(loadDeclarations(key), isOfficialUrl),
    )
    if (problems.length > 0) {
      process.stderr.write(
        `声明来源检查失败：\n${problems.map((item) => `- ${item}`).join('\n')}\n`,
      )
      return 1
    }
    const total = new Set(
      platformKeys().flatMap((key) => loadDeclarations(key).map((item) => item.canonicalId)),
    ).size
    process.stdout.write(`声明来源检查通过：${total} 个声明都有官方 https 来源和核对日期\n`)
    return 0
  }
  if (command === 'audit') {
    const options = parseFlags(rest)
    const results: AuditResult[] = []
    try {
      for (const platform of options.platforms) {
        const result = await auditPlatform(platform, options)
        results.push(result)
        const count = (kind: Gap['kind']) => result.gaps.filter((gap) => gap.kind === kind).length
        process.stdout.write(
          `${platform}：生命周期 ${count('lifecycle')}，列表缺失 ${count('unlisted')}，` +
            `未声明 ${count('undeclared')}，抓取失败 ${result.errors}` +
            ` → .upstream-docs/${platform}/report.md\n`,
        )
      }
    } finally {
      await closeRenderer()
    }
    githubOutput({
      attention: String(results.some((result) => result.attention)),
      errors: String(results.reduce((sum, result) => sum + result.errors, 0)),
    })
    return 0
  }
  process.stderr.write(
    '用法：cli.ts coverage | audit [--platform <key>]... [--apply] [--offline] [--skeleton <id>]... [--today YYYY-MM-DD]\n',
  )
  return 2
}

process.exitCode = await main(process.argv.slice(2))
