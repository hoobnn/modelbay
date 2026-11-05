/**
 * 统一抽取与对账：输入「本次抓到的官方页面 + 已声明的模型」，输出差距列表。这里只有纯函数，不联网、不读写文件，
 * 测试直接喂 Markdown 字符串。
 *
 * 每次都拿本次抓到的官方原文和声明双向核对，不依赖任何保存下来的历史状态。
 *
 * 声明 → 官方：
 * - `lifecycle`：下线 / 弃用公告点名了我们的模型，而声明的生命周期对不上，附生成好的补丁；
 * - `unlisted`：渠道内 ID 和别名在该渠道的列表页、声明自己引用的来源页里都找不到；
 * - `legacy`：只出现在列表页的历史 / 已下线小节，声明却还是 active。
 *
 * 官方 → 声明：
 * - `undeclared`：官方列表页里有、我们没声明的模型 ID。
 */
import { dates, parseRows, plainText, type Row, tokens } from './markdown'

export type PageRole = 'list' | 'deprecation' | 'reference'

export interface Snapshot {
  url: string
  role: PageRole
  channel?: string
  markdown: string
  /** 跟进抓取的公告：链接所在小节标题里的日期。 */
  contextDates?: string[]
}

export type LifecycleStatus =
  | 'active'
  | 'superseded'
  | 'sunsetting'
  | 'closed-to-new-accounts'
  | 'retired'

export interface DeclaredModel {
  canonicalId: string
  id: string
  title: string
  capabilities: string[]
  channels: { channel: string; id: string }[]
  /** 官方别名与简称。 */
  aliases: string[]
  status: LifecycleStatus
  sunsetOn?: string
  /** 生命周期当前引用的来源。 */
  lifecycleSource?: string
  /** 声明引用的全部来源地址。 */
  sources: string[]
}

export interface Evidence {
  url: string
  section: string
  quote: string
  dates: string[]
  /** 行里明确写了「已下线」之类的终态。 */
  retired?: boolean
}

export interface LifecycleGap {
  kind: 'lifecycle'
  canonicalId: string
  ids: string[]
  current: { status: LifecycleStatus; sunsetOn?: string; source?: string }
  proposed: { status: 'sunsetting' | 'retired'; sunsetOn?: string; source: string }
  evidence: Evidence[]
}

export interface UnlistedGap {
  kind: 'unlisted'
  canonicalId: string
  channel: string
  id: string
  pages: string[]
}

export interface UndeclaredGap {
  kind: 'undeclared'
  channel: string
  id: string
  capability?: string
  evidence: Evidence
}

export interface LegacyGap {
  kind: 'legacy'
  canonicalId: string
  channel: string
  id: string
  evidence: Evidence
}

export type Gap = LifecycleGap | UnlistedGap | LegacyGap | UndeclaredGap

export interface AuditInput {
  platform: string
  today: string
  snapshots: Snapshot[]
  declared: DeclaredModel[]
  /** 额外的候选前缀与排除前缀，见 sources.ts。 */
  prefixes?: string[]
  excludePrefixes?: string[]
  /** 本来就不在官方列表和来源页里的渠道内 ID。 */
  unlisted?: string[]
}

/** 表头里表示「替代 / 迁移目标」的列：这些列里出现的模型不是被下线的那个。 */
const REPLACEMENT_HEADER =
  /替代|替换|迁移|replacement|recommended|instead|alternative|substitute|successor/i

/** 明确已下线的状态词。 */
const RETIRED_WORDS =
  /已下线|已停止服务|已停服|已停用|retired|shut ?down|removed from the api|discontinued/i

/** 列表页里表示「历史 / 旧版」的小节：模型还列着，但官方已不再主推。表格行写着「已下线」也按这类处理。 */
const LEGACY_SECTION =
  /历史模型|历史版本|旧版|legacy|deprecated|previous (models|generation)|older models/i

const lower = (value: string) => value.toLowerCase()

/** 一行里参与判断的文本：表格行去掉替代列。 */
function relevantText(row: Row): string {
  if (row.header.length === 0) return row.cells.join(' ')
  return row.cells.filter((_, index) => !REPLACEMENT_HEADER.test(row.header[index] ?? '')).join(' ')
}

function sectionOf(row: Row): string {
  return row.path.map((heading) => heading.text).join(' › ')
}

function quoteOf(row: Row): string {
  const text = plainText(row.raw)
  return text.length > 240 ? `${text.slice(0, 237)}…` : text
}

const pathKey = (row: Row, depth: number) =>
  row.path
    .slice(0, depth)
    .map((heading) => `${heading.level}:${heading.text}`)
    .join('\n')

/**
 * 行本身没有日期时，从所在小节往外找：先找最近一层标题下所有行里出现的日期，
 * 找不到再往外一层（火山的下线公告把 EOM / EOS 日期写在同一批次的「下线计划」表里）。
 */
function scopeDates(rows: Row[], row: Row): string[] {
  for (let depth = row.path.length; depth >= 1; depth -= 1) {
    const key = pathKey(row, depth)
    const found = new Set<string>()
    for (const other of rows) {
      if (other.path.length >= depth && pathKey(other, depth) === key) {
        for (const value of dates(other.raw)) found.add(value)
      }
    }
    if (found.size > 0) return [...found].sort()
  }
  return []
}

/** 候选模型 ID 的前缀：已声明 ID 的首个字母段，加上配置里的额外前缀。 */
export function candidatePrefixes(input: AuditInput): Set<string> {
  const prefixes = new Set<string>(input.prefixes?.map(lower) ?? [])
  for (const model of input.declared) {
    for (const ref of model.channels) {
      const word = /^[a-z]+/.exec(lower(ref.id))?.[0]
      if (word && word.length >= 2) prefixes.add(word)
    }
  }
  for (const excluded of input.excludePrefixes ?? []) prefixes.delete(lower(excluded))
  return prefixes
}

const FILE_LIKE = /\.(md|png|jpe?g|gif|svg|html?|json|ya?ml|py|js|ts|mp[34]|wav|zip)$/i

/** 记号像不像模型 ID：含数字和连接符、前缀在候选前缀里、不是文件名或纯日期。 */
export function isCandidateId(
  token: string,
  prefixes: Set<string>,
  lowercaseOnly = false,
): boolean {
  if (token.length < 4 || token.length > 80) return false
  if (lowercaseOnly && token !== lower(token)) return false
  if (!/[a-z]/i.test(token) || !/\d/.test(token) || !/[-.]/.test(token)) return false
  if (FILE_LIKE.test(token) || token.includes('/')) return false
  const word = /^[a-z]+/.exec(lower(token))?.[0]
  return word !== undefined && prefixes.has(word)
}

const CAPABILITY_HINTS: [RegExp, string][] = [
  [/rerank|重排/i, 'native:rerank'],
  [/向量|embedding/i, 'text.embed'],
  [/音乐|music/i, 'audio.music'],
  [/语音识别|录音文件识别|asr|transcri|speech[- ]to[- ]text/i, 'audio.transcribe'],
  [/声音复刻|复刻|voice clon/i, 'voice.clone'],
  [/语音合成|tts|text[- ]to[- ]speech|speech|配音/i, 'audio.speech'],
  [/视频|video/i, 'video.generate'],
  [/图片|图像|文生图|image/i, 'image.generate'],
  [/文本生成|语言模型|对话|深度思考|chat|text generation|reasoning|llm/i, 'text.chat'],
]

/** 从行文本、表头、所在小节由近到远猜能力，只用来填骨架，必须人工核对。 */
export function guessCapability(row: Row): string | undefined {
  const contexts = [
    relevantText(row),
    row.header.join(' '),
    ...row.path.map((heading) => heading.text).reverse(),
  ]
  for (const context of contexts) {
    const hit = CAPABILITY_HINTS.find(([pattern]) => pattern.test(context))
    if (hit) return hit[1]
  }
  return undefined
}

/** 链接路径的最后一段（去掉 `.md`）：有的列表页只在链接里写模型 ID，比如 `/models/gpt-6-luna`。 */
export function linkIds(markdown: string): string[] {
  const found: string[] = []
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const path = match[1]!.split(/[?#]/)[0]!.replace(/\/$/, '').replace(/\.md$/, '')
    const last = path.split('/').pop()
    if (last) found.push(last)
  }
  return found
}

function proposedLifecycle(
  evidence: Evidence[],
  today: string,
): { status: 'sunsetting' | 'retired'; sunsetOn?: string; source: string } {
  const explicit = evidence.find((item) => item.retired)
  if (explicit) return { status: 'retired', source: explicit.url }
  const all = evidence.flatMap((item) => item.dates)
  const shutdown = all.length > 0 ? [...all].sort().at(-1) : undefined
  const source = evidence[0]!.url
  if (shutdown && shutdown > today) return { status: 'sunsetting', sunsetOn: shutdown, source }
  return { status: 'retired', source }
}

function needsLifecycleChange(
  model: DeclaredModel,
  proposed: { status: 'sunsetting' | 'retired'; sunsetOn?: string },
): boolean {
  if (model.status === 'retired') return false
  if (proposed.status === 'retired') return true
  if (model.status !== 'sunsetting') return true
  return model.sunsetOn !== proposed.sunsetOn
}

/** 主入口：抽取并对账一个平台。 */
export function audit(input: AuditInput): Gap[] {
  const gaps: Gap[] = []
  const prefixes = candidatePrefixes(input)
  const lowercaseOnly = input.declared.every((model) =>
    model.channels.every((ref) => ref.id === lower(ref.id)),
  )
  const unlisted = new Set((input.unlisted ?? []).map(lower))

  // 已声明的名字 → 模型（渠道内 ID 和别名都算）
  const byName = new Map<string, DeclaredModel>()
  for (const model of input.declared) {
    for (const name of [...model.channels.map((ref) => ref.id), ...model.aliases]) {
      byName.set(lower(name), model)
    }
  }

  const parsed = input.snapshots.map((snapshot) => ({
    snapshot,
    rows: parseRows(snapshot.markdown),
  }))

  // 1. 下线 / 弃用公告点名的已声明模型。列表页上的「已下线」标签不出补丁：官方常用它表示
  //    「不再对新用户开放」，和公告里的正式下线日期对不上，只在第 2 步按历史模型报告。
  const mentions = new Map<DeclaredModel, { ids: Set<string>; evidence: Evidence[] }>()
  for (const { snapshot, rows } of parsed) {
    if (snapshot.role !== 'deprecation') continue
    for (const row of rows) {
      const text = relevantText(row)
      const named = new Map<string, string>()
      for (const token of tokens(text)) {
        if (byName.has(lower(token)) && !named.has(lower(token))) named.set(lower(token), token)
      }
      if (named.size === 0) continue
      let found = dates(text)
      // 行里没有日期时，往外找跟进时带来的上下文日期和所在小节的日期
      if (found.length === 0) {
        found = snapshot.contextDates ?? []
        if (found.length === 0) found = scopeDates(rows, row)
      }
      for (const [name, original] of named) {
        const model = byName.get(name)!
        const entry = mentions.get(model) ?? { ids: new Set(), evidence: [] }
        entry.ids.add(original)
        entry.evidence.push({
          url: snapshot.url,
          section: sectionOf(row),
          quote: quoteOf(row),
          dates: found,
          ...(RETIRED_WORDS.test(text) ? { retired: true } : {}),
        })
        mentions.set(model, entry)
      }
    }
  }
  for (const [model, { ids, evidence }] of mentions) {
    const proposed = proposedLifecycle(evidence, input.today)
    if (!needsLifecycleChange(model, proposed)) continue
    gaps.push({
      kind: 'lifecycle',
      canonicalId: model.canonicalId,
      ids: [...ids].sort(),
      current: {
        status: model.status,
        ...(model.sunsetOn ? { sunsetOn: model.sunsetOn } : {}),
        ...(model.lifecycleSource ? { source: model.lifecycleSource } : {}),
      },
      proposed,
      evidence,
    })
  }

  // 2. 列表页：每个渠道的已列出名字、未声明的候选 ID
  const listedByChannel = new Map<string, { names: Set<string>; pages: string[] }>()
  const currentNames = new Set<string>()
  const legacyHits = new Map<string, { model: DeclaredModel; id: string; evidence: Evidence }>()
  const candidates = new Map<string, UndeclaredGap>()
  for (const { snapshot, rows } of parsed) {
    if (snapshot.role !== 'list' || !snapshot.channel) continue
    const channel = snapshot.channel
    const listed = listedByChannel.get(channel) ?? { names: new Set<string>(), pages: [] }
    listed.pages.push(snapshot.url)
    for (const row of rows) {
      const legacy =
        row.path.some((heading) => LEGACY_SECTION.test(heading.text)) ||
        (row.header.length > 0 && RETIRED_WORDS.test(relevantText(row)))
      for (const token of [...tokens(row.raw), ...linkIds(row.raw)]) {
        const name = lower(token)
        if (legacy) {
          const model = byName.get(name)
          if (model && !legacyHits.has(`${channel}\n${model.canonicalId}`)) {
            legacyHits.set(`${channel}\n${model.canonicalId}`, {
              model,
              id: token,
              evidence: {
                url: snapshot.url,
                section: sectionOf(row),
                quote: quoteOf(row),
                dates: [],
              },
            })
          }
        } else {
          currentNames.add(`${channel}\n${name}`)
        }
        listed.names.add(name)
        const key = `${channel}\n${name}`
        if (
          byName.has(name) ||
          candidates.has(key) ||
          !isCandidateId(token, prefixes, lowercaseOnly)
        ) {
          continue
        }
        const capability = guessCapability(row)
        candidates.set(key, {
          kind: 'undeclared',
          channel,
          id: token,
          ...(capability ? { capability } : {}),
          evidence: { url: snapshot.url, section: sectionOf(row), quote: quoteOf(row), dates: [] },
        })
      }
    }
    listedByChannel.set(channel, listed)
  }

  // 声明引用的来源页上出现的名字（含代码块里的 API 规格）：列表页漏列、但自己的 API 文档
  // 写明了的模型不算缺失
  const namesByUrl = new Map<string, Set<string>>()
  for (const { snapshot } of parsed) {
    const names = new Set<string>()
    for (const token of [...tokens(snapshot.markdown), ...linkIds(snapshot.markdown)]) {
      names.add(lower(token))
    }
    namesByUrl.set(snapshot.url, names)
  }

  for (const model of input.declared) {
    if (model.status === 'retired') continue
    const ownNames = new Set(model.sources.flatMap((url) => [...(namesByUrl.get(url) ?? [])]))
    for (const ref of model.channels) {
      const listed = listedByChannel.get(ref.channel)
      if (!listed || unlisted.has(lower(ref.id))) continue
      const names = [ref.id, ...model.aliases].map(lower)
      if (names.some((name) => listed.names.has(name) || ownNames.has(name))) continue
      gaps.push({
        kind: 'unlisted',
        canonicalId: model.canonicalId,
        channel: ref.channel,
        id: ref.id,
        pages: listed.pages,
      })
    }
  }
  for (const [key, hit] of legacyHits) {
    const channel = key.split('\n')[0]!
    if (hit.model.status !== 'active') continue
    const names = [...hit.model.channels.map((ref) => ref.id), ...hit.model.aliases].map(lower)
    if (names.some((name) => currentNames.has(`${channel}\n${name}`))) continue
    gaps.push({
      kind: 'legacy',
      canonicalId: hit.model.canonicalId,
      channel,
      id: hit.id,
      evidence: hit.evidence,
    })
  }
  gaps.push(...candidates.values())

  return gaps
}
