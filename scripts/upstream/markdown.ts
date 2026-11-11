/**
 * 官方文档的统一文本模型：所有来源（官方 Markdown、页面内嵌的 Markdown、浏览器渲染）都先转成
 * Markdown，再在这里切成「行」：表格的每一行带上表头，正文的每一行带上所在的标题路径。
 * 抽取和对账只依赖这里的结构，不关心页面原来是什么格式。
 */

export interface Heading {
  level: number
  text: string
}

/** 文档里的一行：表格行（带表头）或正文行。 */
export interface Row {
  /** 所在标题路径，由外到内。 */
  path: Heading[]
  /** 表格行的单元格；正文行只有一个单元格。 */
  cells: string[]
  /** 表格行对应的表头；正文行为空。 */
  header: string[]
  /** 原始行（用作引用）。 */
  raw: string
  /** 1 起的行号。 */
  line: number
}

/** 规范化快照：去 BOM、统一换行、去行尾空白、压缩连续空行。快照和比对都用它。 */
export function normalizeSnapshot(markdown: string): string {
  return (
    markdown
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

/** 去掉 Markdown 语法，只留可读文本：反斜杠转义、链接地址、HTML 标签（保留 title 属性）、强调符号。 */
export function plainText(markdown: string): string {
  return (
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      // 卡片等组件把模型名写在 title 属性里（如百炼总览页的 <Card title="qwen4-max-preview">），先取出来再删标签
      .replace(/<[A-Za-z][^>]*?\stitle="([^"]*)"[^>]*>/g, ' $1 ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*\\?$/

function splitCells(line: string): string[] {
  let body = line.trim().replace(/\s*\\$/, '')
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  // 转义的 \| 是单元格内容，不是分隔符
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim())
}

/** 把 Markdown 切成行；表格识别「表头行 + 分隔行」，之后连续的 `|` 行都算表格行。 */
export function parseRows(markdown: string): Row[] {
  const lines = markdown.split('\n')
  const rows: Row[] = []
  const path: Heading[] = []
  let header: string[] | null = null
  // 当前代码块的开头标记（如 ```` 或 ~~~）；结束标记要同种字符、长度不少于开头
  let fence: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const trimmed = raw.trim()
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && trimmed === marker) {
        fence = null
      }
      continue
    }
    if (marker) {
      fence = marker
      continue
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed)
    if (heading) {
      const level = heading[1]!.length
      while (path.length > 0 && path[path.length - 1]!.level >= level) path.pop()
      path.push({ level, text: plainText(heading[2]!) })
      header = null
      continue
    }

    if (trimmed.startsWith('|')) {
      const next = lines[index + 1]?.trim() ?? ''
      if (!header && TABLE_SEPARATOR.test(next)) {
        header = splitCells(trimmed).map(plainText)
        index += 1
        continue
      }
      if (header) {
        rows.push({ path: [...path], cells: splitCells(trimmed), header, raw, line: index + 1 })
        continue
      }
    } else {
      header = null
    }

    if (trimmed.length > 0) {
      rows.push({ path: [...path], cells: [trimmed], header: [], raw, line: index + 1 })
    }
  }
  return rows
}

/** 行里可能是模型 ID 的记号：字母数字开头结尾，中间可以有 `.`、`-`、`_`、`/`。 */
export function tokens(text: string): string[] {
  const found = plainText(text).match(/[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?/g) ?? []
  return found.flatMap((token) => (token.includes('/') ? [token, ...token.split('/')] : [token]))
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function iso(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 抽出文本里的日期，统一成 `YYYY-MM-DD`。支持 `2026-9-24`、`2026/09/24`、`2026年9月24日`、
 * `January 14, 2027`、`Apr 1, 2027`、`14 January 2027`。模型 ID 里的日期后缀（如
 * `qwen3-tts-flash-2025-09-18`）前面紧跟字母或连字符，不算日期。
 */
export function dates(text: string): string[] {
  const plain = plainText(text)
  const found: string[] = []
  const numeric = /(?<![\w-])(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})(?!\d)/g
  for (const match of plain.matchAll(numeric)) {
    const value = iso(Number(match[1]), Number(match[2]), Number(match[3]))
    if (value) found.push(value)
  }
  const monthFirst = /\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g
  for (const match of plain.matchAll(monthFirst)) {
    const month = MONTHS[match[1]!.slice(0, 3).toLowerCase()]
    const value = month ? iso(Number(match[3]), month, Number(match[2])) : null
    if (value) found.push(value)
  }
  const dayFirst = /\b(\d{1,2})\s+([A-Z][a-z]{2,8})\.?,?\s+(\d{4})\b/g
  for (const match of plain.matchAll(dayFirst)) {
    const month = MONTHS[match[2]!.slice(0, 3).toLowerCase()]
    const value = month ? iso(Number(match[3]), month, Number(match[1])) : null
    if (value) found.push(value)
  }
  return [...new Set(found)].sort()
}
