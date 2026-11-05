/**
 * 分档抓取官方文档，统一产出 Markdown：
 *
 * 1. `markdown`：带 `Accept: text/markdown` 请求，站点直接返回 Markdown（MiniMax、OpenAI、火山套餐页）。
 * 2. `markdown-suffix`：在路径后加 `.md`（阿里云帮助中心）。
 * 3. `embedded-markdown`：HTML 里给出了 Markdown 地址（火山文档的 `LlmsMdUrl`）。
 * 4. `rendered`：以上都没有时用无头浏览器渲染，再把正文 DOM 转成 Markdown（阿里云公告页）。
 *
 * 只抓白名单里的官方 https 域名；失败一律抛错，不把抓取失败当成「没有变化」。
 */
import { isOfficialUrl, RENDER_SELECTORS } from './sources'

export type FetchMethod = 'markdown' | 'markdown-suffix' | 'embedded-markdown' | 'rendered'

export interface FetchedPage {
  url: string
  method: FetchMethod
  markdown: string
}

const USER_AGENT = 'Mozilla/5.0 (compatible; modelbay-upstream-docs/1.0)'

/** 同一篇文档的另一个入口：`www.volcengine.com/docs` 连续请求会被反爬校验拦下，文档站本身不会。 */
function fetchUrl(url: string): string {
  return url.replace(/^https:\/\/www\.volcengine\.com\/docs\//, 'https://docs.volcengine.com/docs/')
}
const MAX_BYTES = 16 * 1024 * 1024

interface RawResponse {
  status: number
  type: string
  body: string
  url: string
}

async function get(url: string, accept: string, timeoutMs: number): Promise<RawResponse> {
  if (!isOfficialUrl(url)) throw new Error(`不是白名单里的官方 https 地址：${url}`)
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!isOfficialUrl(response.url)) throw new Error(`跳转到了白名单外的地址：${response.url}`)
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new Error(`响应超过 16MB：${url}`)
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body: new TextDecoder('utf-8').decode(buffer),
    url: response.url,
  }
}

function looksLikeMarkdown(response: RawResponse): boolean {
  if (response.status !== 200) return false
  if (!/markdown|text\/plain/i.test(response.type)) return false
  return !/^\s*<(!doctype|html)/i.test(response.body)
}

function markdownSuffixUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}.md`
}

function embeddedMarkdownUrl(html: string): string | null {
  const match = /"LlmsMdUrl":"((?:[^"\\]|\\.)+)"/.exec(html)
  if (!match) return null
  return JSON.parse(`"${match[1]}"`) as string
}

interface Renderer {
  render(url: string, timeoutMs: number): Promise<string>
  close(): Promise<void>
}

let renderer: Promise<Renderer> | null = null

/** 浏览器只在确实需要渲染时才加载，离线命令和不需要渲染的平台不依赖 Playwright。 */
async function getRenderer(): Promise<Renderer> {
  renderer ??= (async () => {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    return {
      async render(url, timeoutMs) {
        const page = await browser.newPage()
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
          if (!isOfficialUrl(page.url())) throw new Error(`跳转到了白名单外的地址：${page.url()}`)
          const selector = RENDER_SELECTORS[new URL(url).hostname]!
          await page.waitForSelector(selector, { timeout: timeoutMs })
          return await page.$eval(selector, domToMarkdown)
        } finally {
          await page.close()
        }
      },
      close: () => browser.close(),
    }
  })()
  return renderer
}

export async function closeRenderer(): Promise<void> {
  if (!renderer) return
  const current = await renderer
  renderer = null
  await current.close()
}

/**
 * 在页面里执行：把正文 DOM 转成 Markdown。标题转 `#`，表格转 `|` 表格（单元格内换行转 `<br>`），
 * 其余块级元素取可见文本。函数会被序列化进浏览器，不能引用外部变量。
 */
function domToMarkdown(root: Element): string {
  const out: string[] = []
  const cell = (element: Element) =>
    ((element as HTMLElement).innerText ?? '')
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\s*\n\s*/g, '<br>')
  const walk = (element: Element) => {
    const tag = element.tagName.toLowerCase()
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return
    if (/^h[1-6]$/.test(tag)) {
      const text = (element as HTMLElement).innerText.trim()
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text.replace(/\s+/g, ' ')}`, '')
      return
    }
    if (tag === 'table') {
      const rows = [...element.querySelectorAll('tr')]
      rows.forEach((row, index) => {
        const cells = [...row.querySelectorAll('th, td')].map(cell)
        out.push(`| ${cells.join(' | ')} |`)
        if (index === 0) out.push(`|${cells.map(() => '---').join('|')}|`)
      })
      out.push('')
      return
    }
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return
    const blockChildren = [...element.children].some((child) =>
      /^(div|p|section|article|ul|ol|li|table|h[1-6]|pre|blockquote)$/i.test(child.tagName),
    )
    if (blockChildren) {
      for (const child of element.children) walk(child)
      return
    }
    const text = ((element as HTMLElement).innerText ?? '').trim()
    if (text) out.push(tag === 'li' ? `- ${text}` : text, '')
  }
  walk(root)
  return out.join('\n')
}

export interface FetchOptions {
  timeoutMs?: number
}

/** 按档位抓一个页面，返回 Markdown。 */
export async function fetchPage(
  original: string,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const url = fetchUrl(original)
  const page = await fetchMarkdown(url, timeoutMs)
  if (page) return { ...page, url: original }
  // 只有登记了正文容器的域名才渲染：其他站点拿不到 Markdown 多半是被限流，渲染出来的是
  // 导航和校验页，会造成误报，宁可算抓取失败
  if (!(new URL(url).hostname in RENDER_SELECTORS)) {
    throw new Error(`没拿到 Markdown 版本，且该域名不在 RENDER_SELECTORS 里：${original}`)
  }
  const markdown = await (await getRenderer()).render(url, timeoutMs)
  if (markdown.trim().length < 100) throw new Error(`渲染后的正文过短，疑似错误页：${original}`)
  return { url: original, method: 'rendered', markdown }
}

async function fetchMarkdown(url: string, timeoutMs: number): Promise<FetchedPage | null> {
  const direct = await get(url, 'text/markdown, text/plain;q=0.9, text/html;q=0.8', timeoutMs)
  if (looksLikeMarkdown(direct)) return { url, method: 'markdown', markdown: direct.body }

  const suffix = await get(markdownSuffixUrl(url), 'text/markdown, text/plain', timeoutMs).catch(
    () => null,
  )
  if (suffix && looksLikeMarkdown(suffix)) {
    return { url, method: 'markdown-suffix', markdown: suffix.body }
  }

  const embedded = direct.status === 200 ? embeddedMarkdownUrl(direct.body) : null
  if (embedded) {
    const response = await get(embedded, 'text/markdown, text/plain', timeoutMs)
    if (looksLikeMarkdown(response)) {
      return { url, method: 'embedded-markdown', markdown: response.body }
    }
  }

  // 登记了正文容器的域名（阿里云公告页）对境外 runner 会直接回 404，浏览器渲染能拿到正文，
  // 所以这些域名的 4xx 交给渲染兜底；其余域名的 4xx 仍算抓取失败
  const renderable = new URL(url).hostname in RENDER_SELECTORS
  if (direct.status >= 400 && direct.status !== 403 && !renderable) {
    throw new Error(`官方文档返回 HTTP ${direct.status}：${url}`)
  }
  return null
}

/** 页面里链到的地址（Markdown 链接和裸链接），用于跟进公告详情。 */
export function linksIn(markdown: string): string[] {
  const found = [
    ...[...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]!),
    ...[...markdown.matchAll(/(?<!\()https?:\/\/[^\s)\]<>"']+/g)].map((match) => match[0]),
  ]
  return [...new Set(found.map((url) => url.replace(/[.,;，。]+$/, '')))]
}
