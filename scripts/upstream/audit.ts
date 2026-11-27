/**
 * 统一抽取与对账：输入「本次抓到的官方页面 + 已声明的模型」，输出差距列表。这里只有纯函数，不联网、不读写文件，
 * 测试直接喂 Markdown 字符串。
 *
 * 每次都拿本次抓到的官方原文和声明双向核对，不依赖任何保存下来的历史状态。
 *
 * 声明 → 官方：
 * - `lifecycle`：下线 / 弃用公告点名了我们的模型，而声明的生命周期对不上，附生成好的补丁；
 *   只出现在列表页历史 / 已下线小节的模型一律归档（`retired`），也走这一类；
 * - `unlisted`：渠道内 ID 和别名在该渠道的列表页、声明自己引用的来源页里都找不到。
 *
 * 官方 → 声明：
 * - `undeclared`：官方列表页当前小节里有、我们没声明的模型 ID。历史模型不再支持，不报；
 *   `skipped` 里登记过、决定不接的也不报。
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

export type Gap = LifecycleGap | UnlistedGap | UndeclaredGap

export interface AuditInput {
  platform: string
  today: string
  snapshots: Snapshot[]
  declared: DeclaredModel[]
  /** 额外的候选前缀与排除前缀，见 sources.ts。 */
  prefixes?: string[]
  excludePrefixes?: string[]
  /**
   * 模型 ID 不带版本号（数字）的前缀。默认候选规则要求 ID 带数字，免得把文档路径
   * 当成模型；有些平台的模型 ID 就是不带数字的（OpenAI 的 `gpt-transcribe`），
   * 在这里按前缀放行。
   */
  digitless?: string[]
  /**
   * 抓取失败的页面。某条声明的来源页在里面时，「官方列表和来源页里都找不到」
   * 判断不了，不报这一类差距（免得限流造成误报）。
   */
  failedUrls?: string[]
  /** 本来就不在官方列表和来源页里的渠道内 ID。 */
  unlisted?: string[]
  /** 官方列表页上有、决定不接的渠道内 ID。 */
  skipped?: string[]
  /** 渠道 → 官方目录的展示写法 → 已声明的 API ID。 */
  catalogAliases?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** 表头里表示「替代 / 迁移目标」的列：这些列里出现的模型不是被下线的那个。 */
const REPLACEMENT_HEADER =
  /替代|替换|迁移|replacement|recommended|instead|alternative|substitute|successor/i

const RETIRED_STATUS = /^(?:retired|shut ?down|removed from the api|discontinued)$/i
const CONFIRMED_RETIREMENT =
  /已(?:经)?(?:下线|停止服务|停服|停用)|\b(?:already|(?:has|have) been|is|are|was|were)\s+(?:retired|shut ?down|removed from the api|discontinued)\b/i
const PURCHASE_END = /\bEOM\b|停止新购|停止新增接入点/i
const SERVICE_END = /\bEOS\b|服务下线|停止服务|停服|关停/i
const EMBEDDING_PURCHASE_ONLY = /\bembedding\b|向量模型|嵌入模型/i
const EXPLICIT_NO_EOS = /(?:只|仅)(?:有|涉及)\s*EOM\b|不涉及\s*EOS\b/i

/** 列表页里表示「历史 / 旧版」的小节，表格行写着「已下线」也算。这类模型一律归档，不再支持。 */
const LEGACY_SECTION =
  /历史模型|历史版本|旧版|legacy|deprecated|previous (models|generation)|older models/i

const lower = (value: string) => value.toLowerCase()

function evidenceCells(row: Row): string[] {
  return row.cells.filter((_, index) => !REPLACEMENT_HEADER.test(row.header[index] ?? ''))
}

function relevantText(row: Row): string {
  return evidenceCells(row).join(' ')
}

function explicitlyRetired(row: Row): boolean {
  return evidenceCells(row).some((cell) => {
    const text = plainText(cell)
    return RETIRED_STATUS.test(text) || CONFIRMED_RETIREMENT.test(text)
  })
}

function sectionOf(row: Row): string {
  return row.path.map((heading) => heading.text).join(' › ')
}

function quoteOf(row: Row, label?: string): string {
  const text = plainText(label ? `${label} | ${row.raw}` : row.raw)
  return text.length > 240 ? `${text.slice(0, 237)}…` : text
}

const pathKey = (row: Row, depth: number) =>
  row.path
    .slice(0, depth)
    .map((heading) => `${heading.level}:${heading.text}`)
    .join('\n')

function purchaseOnly(row: Row): boolean {
  const text = plainText(`${row.header.join(' ')} ${relevantText(row)}`)
  return PURCHASE_END.test(text) && !SERVICE_END.test(text)
}

/**
 * 行本身没有日期时，从所在小节往外找：先找最近一层标题下所有行里出现的日期，
 * 找不到再往外一层（火山的下线公告把 EOM / EOS 日期写在同一批次的「下线计划」表里）。
 *
 * 点名了某个模型的片段（按换行和 `<br>` 切分）里的日期只属于那个模型，不算批次日期：
 * 火山第十批在 EOS 格里用「注意」单列了 doubao-seed-2-0-pro-260215 的 2027-01-22，
 * 其他模型仍是批次的 2026-11-24。
 */
function scopeDates(rows: Row[], row: Row, isModelId: (token: string) => boolean): string[] {
  for (let depth = row.path.length; depth >= 1; depth -= 1) {
    const key = pathKey(row, depth)
    const found = new Set<string>()
    for (const other of rows) {
      if (other.path.length >= depth && pathKey(other, depth) === key && !purchaseOnly(other)) {
        for (const segment of other.raw.split(/<br\s*\/?>|\n/i)) {
          if (tokens(segment).some(isModelId)) continue
          for (const value of dates(segment)) found.add(value)
        }
      }
    }
    if (found.size > 0) return [...found].sort()
  }
  return []
}

/**
 * 候选模型 ID 的前缀：已声明 ID 的首个字母段，加上配置里的额外前缀。
 *
 * 前缀只取开头那段连续字母，所以带数字的系列要写 `hyper` 而不是 `hyper3d`。
 */
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

/**
 * 记号像不像模型 ID：含字母和连接符、前缀在候选前缀里、不是文件名。
 *
 * 默认要求带版本号（数字），免得把文档路径、栏目名当成模型；
 * 有些平台的模型 ID 不带数字（OpenAI 的 `gpt-transcribe`），由平台配置的
 * `digitless` 前缀单独放行。
 */
export function isCandidateId(
  token: string,
  prefixes: Set<string>,
  lowercaseOnly = false,
  digitless: Set<string> = new Set(),
): boolean {
  if (token.length < 4 || token.length > 80) return false
  if (!/^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])$/i.test(token)) return false
  if (lowercaseOnly && token !== lower(token)) return false
  if (!/[a-z]/i.test(token) || !/[-.]/.test(token)) return false
  if (FILE_LIKE.test(token)) return false
  const word = /^[a-z]+/.exec(lower(token))?.[0]
  if (word === undefined || !prefixes.has(word)) return false
  if (!/\d/.test(token) && !digitless.has(word)) return false
  return true
}

/**
 * 「产品名 + 版本号」形态：官方目录页常用它代替 API 模型 ID
 * （豆包语音的「TTS 2.0」「Seed Audio 1.0」，表格列头里就是这些）。
 */
const PRODUCT_VERSION = /^(.+?)\s+v?(\d+(?:\.\d+)*)\s*(?:版本)?$/i
const COMPACT_PRODUCT_VERSION = /^([a-z]+?)v?(\d+(?:\.\d+)*)\s*版本$/i

/** 产品名 + 版本号 → 一个像模型 ID 的候选（小写、空格转连字符）。 */
export function productVersionId(cell: string): string | undefined {
  const label = cell.trim()
  const match = PRODUCT_VERSION.exec(label) ?? COMPACT_PRODUCT_VERSION.exec(label)
  if (!match) return undefined
  const product = match[1]!.trim()
  // 产品名里至少要有一个字母，纯数字的是版本号本身
  if (!/[A-Za-z]/.test(product)) return undefined
  const name = product
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '')
  if (!name) return undefined
  return `${name}-${match[2]!.toLowerCase()}`
}

/**
 * 模型 ID 的词干：去掉开头那段厂商前缀。
 *
 * 官方目录页写「TTS 2.0」，API ID 写 `seed-tts-2.0`，两者只差这一段，
 * 词干相同就当同一个模型。
 */
export function stem(name: string): string {
  const parts = name.split('-')
  return parts.length > 1 ? parts.slice(1).join('-') : name
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
export function guessCapability(row: Row, label = ''): string | undefined {
  const contexts = [
    label,
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
  for (const match of markdown.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const path = match[2]!.split(/[?#]/)[0]!.replace(/\/$/, '').replace(/\.md$/, '')
    const last = path.split('/').pop()
    if (!last) continue
    const qualified = tokens(match[1]!).some((id) => lower(id).endsWith(`/${lower(last)}`))
    if (!qualified) found.push(last)
  }
  return found
}

/** 链接路径可补足展示名称中的 ID。已有完整限定 ID 时，保留它本身作为证据。 */
function documentIds(markdown: string): string[] {
  return [...tokens(markdown), ...linkIds(markdown)]
}

interface CatalogMention {
  id: string
  product?: boolean
  label?: string
}

function catalogMentions(
  row: Row,
  text: string,
  isModelId: (id: string) => boolean,
): CatalogMention[] {
  const names: CatalogMention[] = documentIds(text).map((id) => ({ id }))
  for (const cell of row.header) {
    if (REPLACEMENT_HEADER.test(cell)) continue
    if (isModelId(cell)) {
      names.push({ id: cell, label: cell })
    } else {
      const id = productVersionId(cell)
      if (id) names.push({ id, product: true, label: cell })
    }
  }
  return names
}

function proposedLifecycle(
  evidence: Evidence[],
  today: string,
): { proposed: LifecycleGap['proposed']; decisive: Evidence } | undefined {
  const explicit = evidence.find((item) => item.retired)
  if (explicit) return { proposed: { status: 'retired', source: explicit.url }, decisive: explicit }
  const dated = evidence.flatMap((item) => item.dates.map((date) => ({ date, item })))
  const latest = dated.sort((left, right) => right.date.localeCompare(left.date))[0]
  if (!latest) return undefined
  const { date, item } = latest
  const proposed: LifecycleGap['proposed'] =
    date >= today
      ? { status: 'sunsetting', sunsetOn: date, source: item.url }
      : { status: 'retired', source: item.url }
  return { proposed, decisive: item }
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
  const skipped = new Set((input.skipped ?? []).map(lower))
  const digitless = new Set((input.digitless ?? []).map(lower))
  const failedUrls = new Set(input.failedUrls ?? [])
  const catalogAliases = new Map(
    Object.entries(input.catalogAliases ?? {}).map(([channel, aliases]) => [
      channel,
      new Map(Object.entries(aliases).map(([name, id]) => [lower(name), lower(id)])),
    ]),
  )

  // 已声明的名字 → 模型（渠道内 ID 和别名都算）
  const byName = new Map<string, DeclaredModel>()
  const channelIds = new Set<string>()
  for (const model of input.declared) {
    for (const ref of model.channels) channelIds.add(`${ref.channel}\n${lower(ref.id)}`)
    for (const name of [...model.channels.map((ref) => ref.id), ...model.aliases]) {
      byName.set(lower(name), model)
    }
  }

  // 已声明模型的词干：官方目录页写「产品名 + 版本」时，与 API ID 只差厂商前缀那一段
  const declaredStems = new Set<string>()
  for (const model of input.declared) {
    for (const ref of model.channels) {
      for (const name of [ref.id, ...model.aliases]) declaredStems.add(stem(lower(name)))
    }
  }

  const parsed = input.snapshots.map((snapshot) => ({
    snapshot,
    rows: parseRows(snapshot.markdown),
  }))

  const isModelId = (token: string) =>
    byName.has(lower(token)) || isCandidateId(token, prefixes, lowercaseOnly, digitless)

  // 1. 下线 / 弃用公告点名的已声明模型。列表页上的历史模型在第 2 步一律归档。
  const mentions = new Map<DeclaredModel, { ids: Set<string>; evidence: Evidence[] }>()
  for (const { snapshot, rows } of parsed) {
    if (snapshot.role !== 'deprecation') continue
    const eomEmbeddingSections = new Set(
      rows
        .filter(
          (row) =>
            EMBEDDING_PURCHASE_ONLY.test(relevantText(row)) &&
            EXPLICIT_NO_EOS.test(relevantText(row)),
        )
        .map((row) => pathKey(row, row.path.length)),
    )
    for (const row of rows) {
      if (purchaseOnly(row)) continue
      const text = relevantText(row)
      const named = new Map<DeclaredModel, Set<string>>()
      const retired = explicitlyRetired(row)
      const embeddingPurchaseOnly =
        !retired &&
        !SERVICE_END.test(plainText(text)) &&
        eomEmbeddingSections.has(pathKey(row, row.path.length))
      for (const token of tokens(text)) {
        const model = byName.get(lower(token))
        if (!model) continue
        if (
          embeddingPurchaseOnly &&
          model.capabilities.some((capability) => capability.endsWith('.embed'))
        )
          continue
        const ids = named.get(model) ?? new Set()
        ids.add(token)
        named.set(model, ids)
      }
      if (named.size === 0) continue
      let found = dates(text)
      // 行里没有日期时，往外找跟进时带来的上下文日期和所在小节的日期
      if (found.length === 0) {
        found = snapshot.contextDates ?? []
        if (found.length === 0) found = scopeDates(rows, row, isModelId)
      }
      for (const [model, ids] of named) {
        const entry = mentions.get(model) ?? { ids: new Set(), evidence: [] }
        for (const id of ids) entry.ids.add(id)
        entry.evidence.push({
          url: snapshot.url,
          section: sectionOf(row),
          quote: quoteOf(row),
          dates: found,
          ...(retired ? { retired: true } : {}),
        })
        mentions.set(model, entry)
      }
    }
  }
  for (const [model, { ids, evidence }] of mentions) {
    const proposal = proposedLifecycle(evidence, input.today)
    if (!proposal) continue
    const { proposed, decisive } = proposal
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
      evidence: [decisive, ...evidence.filter((entry) => entry !== decisive)],
    })
  }

  // 2. 列表页：每个渠道的已列出名字、未声明的候选 ID
  const listedByChannel = new Map<
    string,
    { names: Set<string>; products: Set<string>; pages: string[] }
  >()
  const currentNames = new Set<string>()
  const legacyHits = new Map<string, { model: DeclaredModel; id: string; evidence: Evidence }>()
  const candidates = new Map<string, UndeclaredGap>()
  for (const { snapshot, rows } of parsed) {
    if (snapshot.role !== 'list' || !snapshot.channel) continue
    const channel = snapshot.channel
    const aliases = catalogAliases.get(channel)
    const listed = listedByChannel.get(channel) ?? {
      names: new Set<string>(),
      products: new Set<string>(),
      pages: [],
    }
    listed.pages.push(snapshot.url)
    for (const row of rows) {
      const legacy =
        row.path.some((heading) => LEGACY_SECTION.test(heading.text)) ||
        (row.header.length > 0 && explicitlyRetired(row))
      const text = legacy ? relevantText(row) : row.raw
      for (const { id, product, label } of catalogMentions(row, text, isModelId)) {
        const name = lower(id)
        const target = aliases?.get(name)
        const listedName = target && channelIds.has(`${channel}\n${target}`) ? target : name
        const model = byName.get(listedName)
        if (legacy) {
          if (model && !legacyHits.has(`${channel}\n${model.canonicalId}`)) {
            legacyHits.set(`${channel}\n${model.canonicalId}`, {
              model,
              id,
              evidence: {
                url: snapshot.url,
                section: sectionOf(row),
                quote: quoteOf(row, label),
                dates: [],
              },
            })
          }
        } else {
          currentNames.add(`${channel}\n${listedName}`)
        }
        listed.names.add(listedName)
        if (product) listed.products.add(name)
        const key = `${channel}\n${name}`
        if (
          legacy ||
          model ||
          (product && declaredStems.has(name)) ||
          skipped.has(name) ||
          candidates.has(key) ||
          !isCandidateId(id, prefixes, lowercaseOnly, digitless)
        ) {
          continue
        }
        const capability = guessCapability(row, label)
        candidates.set(key, {
          kind: 'undeclared',
          channel,
          id,
          ...(capability ? { capability } : {}),
          evidence: {
            url: snapshot.url,
            section: sectionOf(row),
            quote: quoteOf(row, label),
            dates: [],
          },
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
    for (const token of documentIds(snapshot.markdown)) {
      names.add(lower(token))
    }
    namesByUrl.set(snapshot.url, names)
  }

  for (const model of input.declared) {
    if (model.status === 'retired') continue
    // 来源页没抓到时判断不了它在不在官方文档里，别当成缺失
    if (model.sources.some((url) => failedUrls.has(url))) continue
    const ownNames = new Set(model.sources.flatMap((url) => [...(namesByUrl.get(url) ?? [])]))
    for (const ref of model.channels) {
      const listed = listedByChannel.get(ref.channel)
      if (!listed || unlisted.has(lower(ref.id))) continue
      const names = [ref.id, ...model.aliases].map(lower)
      // 官方目录页写「产品名 + 版本」（TTS 2.0）而 API ID 是 seed-tts-2.0 时，
      // 词干只和表头里的产品名比，不拿普通 ID 的后半段去撞（qwen4-max 与 qwen5-max 不是同一个）
      const stems = names.map(stem)
      const found =
        names.some((name) => listed.names.has(name) || ownNames.has(name)) ||
        stems.some((item) => listed.products.has(item))
      if (found) continue
      gaps.push({
        kind: 'unlisted',
        canonicalId: model.canonicalId,
        channel: ref.channel,
        id: ref.id,
        pages: listed.pages,
      })
    }
  }
  // 历史模型一律归档：只出现在历史 / 已下线小节的已声明模型改成 retired，覆盖公告推算的状态
  const archived = new Map<DeclaredModel, LifecycleGap>()
  for (const [key, hit] of legacyHits) {
    const channel = key.split('\n')[0]!
    const model = hit.model
    if (model.status === 'retired') continue
    // 声明是整份归档的：任一渠道的当前小节还列着它，就不归档
    const names = [...model.channels.map((ref) => ref.id), ...model.aliases].map(lower)
    const channels = new Set([channel, ...model.channels.map((ref) => ref.channel)])
    // 有渠道没抓到列表页（抓取失败或没配置），判断不了它还在不在当前小节，先不归档
    if ([...channels].some((item) => !listedByChannel.has(item))) continue
    const current = [...channels].some((item) =>
      names.some((name) => currentNames.has(`${item}\n${name}`)),
    )
    if (current) continue
    const entry = archived.get(model)
    if (entry) {
      if (!entry.ids.includes(hit.id)) entry.ids.push(hit.id)
      entry.evidence.push(hit.evidence)
      continue
    }
    archived.set(model, {
      kind: 'lifecycle',
      canonicalId: model.canonicalId,
      ids: [hit.id],
      current: {
        status: model.status,
        ...(model.sunsetOn ? { sunsetOn: model.sunsetOn } : {}),
        ...(model.lifecycleSource ? { source: model.lifecycleSource } : {}),
      },
      proposed: { status: 'retired', source: hit.evidence.url },
      evidence: [hit.evidence],
    })
  }
  for (const [model, gap] of archived) {
    const index = gaps.findIndex(
      (other) => other.kind === 'lifecycle' && other.canonicalId === model.canonicalId,
    )
    if (index >= 0) gaps.splice(index, 1, gap)
    else gaps.push(gap)
  }
  gaps.push(...candidates.values())

  return gaps
}
