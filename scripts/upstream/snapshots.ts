import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { Snapshot } from './audit'

export type PageEntry = Omit<Snapshot, 'markdown'> & { method?: string }

export type CapturedPage = { entry: PageEntry } & (
  | { markdown: string; error?: never }
  | { error: string; markdown?: never }
)

type SavedPage = PageEntry & { file?: string; error?: string }

export function captureCoverage(captured: readonly CapturedPage[]) {
  const failed = captured.filter((page) => page.error !== undefined)
  return {
    failedUrls: failed.map((page) => page.entry.url),
    complete: captured.length > 0 && failed.length === 0,
    lifecycleComplete:
      captured.some((page) => page.entry.role !== 'reference') &&
      failed.every((page) => page.entry.role === 'reference'),
  }
}

function legacySlug(url: string): string {
  const parsed = new URL(url)
  return `${parsed.hostname}${parsed.pathname}${parsed.search}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function readIndex(directory: string): SavedPage[] {
  const path = join(directory, 'pages.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SavedPage[]) : []
}

function pageFile(page: SavedPage): string | undefined {
  if (page.error) return undefined
  const name = page.file ?? `${legacySlug(page.url)}.md`
  return basename(name) === name && name.endsWith('.md') ? name : undefined
}

/** 保存成功与失败的页面，全部写好后再切换索引。旧索引中的文件不被覆盖。 */
export function writeCapture(directory: string, captured: readonly CapturedPage[]): void {
  const previous = readIndex(directory)
  const pages = join(directory, 'pages')
  mkdirSync(pages, { recursive: true })
  const stage = mkdtempSync(join(directory, '.capture-'))
  const written: string[] = []
  try {
    const index = captured.map(({ entry, markdown, error }): SavedPage => {
      if (markdown === undefined) return { ...entry, error }
      const hash = createHash('sha256').update(entry.url).digest('hex').slice(0, 12)
      const file = `${legacySlug(entry.url).slice(0, 100)}-${hash}${basename(stage)}.md`
      const path = join(pages, file)
      written.push(path)
      writeFileSync(path, markdown)
      return { ...entry, file }
    })
    const stagedIndex = join(stage, 'pages.json')
    writeFileSync(stagedIndex, `${JSON.stringify(index, null, 2)}\n`)
    renameSync(stagedIndex, join(directory, 'pages.json'))
  } catch (error) {
    for (const path of written) rmSync(path, { force: true })
    throw error
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  for (const page of previous) {
    const file = pageFile(page)
    if (file) rmSync(join(pages, file), { force: true })
  }
}

/** 兼容原先只存成功页面的索引。缺文件和旧文件名冲突都会留下失败状态。 */
export function readCapture(directory: string): CapturedPage[] {
  const index = readIndex(directory)
  const counts = new Map<string, number>()
  for (const page of index) {
    const file = pageFile(page)
    if (file) counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return index.map((page) => {
    const { file: _, error, ...entry } = page
    if (error !== undefined) return { entry, error }
    const file = pageFile(page)
    const path = file ? join(directory, 'pages', file) : undefined
    if (!file || !path) return { entry, error: '缓存页面文件名无效' }
    if (counts.get(file) !== 1) return { entry, error: '缓存中多个来源使用同一个文件名' }
    try {
      return { entry, markdown: readFileSync(path, 'utf8') }
    } catch (error) {
      return { entry, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
