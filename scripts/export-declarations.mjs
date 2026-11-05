#!/usr/bin/env node
// M2 声明抽取：把 docs/inventory/plein-models.json 转成 0003 的独立声明。
// 产物：packages/<平台>/src/models/*.ts + index.ts、declarations/<平台>/*.json、
//       declarations/_meta.json（比对用的决策元数据）。
// 可重复执行、幂等：每次重建上述目录，再调用 compare-inventory 生成 diff 文档。
// 生成后调用本仓库的 vp fmt 就地格式化 .ts/.json，保证与 vp check 的格式一致。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run as compareRun } from './compare-inventory.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const INVENTORY = join(root, 'docs/inventory/plein-models.json')
const MCP_DIR = join(root, 'docs/inventory')
const DECL_DIR = join(root, 'declarations')
const META_PATH = join(DECL_DIR, '_meta.json')
const CHECKED_AT = '2026-11-05'

// ── 平台映射 ────────────────────────────────────────────────────────────
// mock 不是真实平台，跳过；方舟按量/套餐两个 provider 都归 ark 包，渠道不同。
const PLATFORM_MAP = {
  'minimax/api': { platform: 'minimax', channel: 'minimax', vendor: 'minimax' },
  'doubao/speech': { platform: 'doubao-speech', channel: 'doubao-speech', vendor: 'doubao' },
  'openai/api': { platform: 'openai', channel: 'openai', vendor: 'openai' },
  'aliyun/bailian': { platform: 'bailian', channel: 'bailian', vendor: 'aliyun' },
  'volc/ark-plan': { platform: 'ark', channel: 'ark-plan', vendor: 'volc' },
  'volc/ark': { platform: 'ark', channel: 'ark', vendor: 'volc' },
}
const SKIPPED = new Set(['plein/mock'])
const PLATFORMS = ['ark', 'bailian', 'minimax', 'doubao-speech', 'openai']

// 各平台官方模型列表/文档页（source.url 与 active 的 lifecycle.source.url）
const PLATFORM_URL = {
  ark: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
  bailian: 'https://help.aliyun.com/zh/model-studio/models',
  minimax: 'https://platform.minimax.cn/docs/faq/models',
  'doubao-speech': 'https://docs.volcengine.com/docs/6561/2499930',
  openai: 'https://platform.openai.com/docs/models',
}
// 2026-11-05 逐个打开官方原文核对后的来源页：只列真正读到正文的页面。
const SOURCE_URL = {
  'ark-plan':
    'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
  'bailian-image': 'https://help.aliyun.com/zh/model-studio/image-model',
  'bailian-video': 'https://help.aliyun.com/zh/model-studio/video-generation',
  'minimax-video': 'https://platform.minimax.cn/docs/api-reference/video-generation-v2-create',
  'doubao-speech-tts':
    'https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http',
  'doubao-speech-asr': 'https://docs.volcengine.com/docs/6561/1354869',
}
// 读不到正文的页面（正文由前端渲染）保持原来的核对日期，不假装核对过。
const SOURCE_CHECKED_AT = {
  'https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh': '2026-11-04',
  'https://www.volcengine.com/docs/6561/79820': '2026-11-04',
}

// 2026-11-05 没能读到官方正文的模型：保持原来的来源与核对日期。
// 这里记的是当初那批声明引用的页面，不换成读过但没这个模型的页面。
const UNVERIFIED_URL = {
  ark: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
  bailian: 'https://help.aliyun.com/zh/model-studio/models',
  'doubao-speech': 'https://www.volcengine.com/docs/6561/79820',
}
const UNVERIFIED = {
  ark: new Set([
    'ark-code-latest',
    'custom-chat',
    'custom-image',
    'custom-video',
    'kimi-k2.7-code',
    'minimax-m3',
  ]),
  bailian: new Set(['qwen3-tts-instruct-flash']),
  'doubao-speech': new Set(['seed-icl-1.0']),
}

// 逐个模型的来源覆盖：平台 + 模型 ID → 来源页。
const SOURCE_RULES = [
  {
    match: (c) => c.platform === 'ark' && UNVERIFIED.ark.has(c.id),
    url: UNVERIFIED_URL.ark,
    checkedAt: '2026-11-04',
  },
  {
    match: (c) =>
      c.platform === 'ark' &&
      Array.isArray(c.channels) &&
      c.channels.includes('ark-plan') &&
      !c.channels.includes('ark'),
    url: SOURCE_URL['ark-plan'],
  },
  {
    match: (c) =>
      c.platform === 'bailian' &&
      ['qwen-image-3.0', 'qwen-image-3.0-pro', 'wanx2.1-imageedit'].includes(c.id),
    url: SOURCE_URL['bailian-image'],
  },
  {
    match: (c) => c.platform === 'bailian' && ['wan3.0-video', 'wan3.0-video-prime'].includes(c.id),
    url: SOURCE_URL['bailian-video'],
  },
  {
    match: (c) =>
      c.platform === 'minimax' && ['MiniMax-H3-Highspeed', 'MiniMax-H3-Lite'].includes(c.id),
    url: SOURCE_URL['minimax-video'],
  },
  {
    match: (c) => c.platform === 'doubao-speech' && ['seed-tts-2.0', 'seed-icl-2.0'].includes(c.id),
    url: SOURCE_URL['doubao-speech-tts'],
  },
  {
    match: (c) => c.platform === 'doubao-speech' && c.id === 'bigmodel',
    url: SOURCE_URL['doubao-speech-asr'],
  },
  {
    match: (c) => c.platform === 'doubao-speech' && UNVERIFIED['doubao-speech'].has(c.id),
    url: UNVERIFIED_URL['doubao-speech'],
    checkedAt: '2026-11-04',
  },
  {
    match: (c) => c.platform === 'bailian' && UNVERIFIED.bailian.has(c.id),
    url: UNVERIFIED_URL.bailian,
    checkedAt: '2026-11-04',
  },
]

// 每个（平台, 能力）的默认模型：与 Python 版 MCP 的默认值对齐，
// 写进声明的 default 标记；不再靠声明顺序挑第一个 active 的。
const DEFAULT_RULES = [
  { platform: 'ark', id: 'doubao-seed-2-1-pro-260915' },
  { platform: 'ark', id: 'doubao-seed-2.1-pro' },
  { platform: 'ark', id: 'doubao-seedream-5-0-pro-260628' },
  { platform: 'ark', id: 'doubao-seedance-2-5-260628' },
  { platform: 'ark', id: 'doubao-seed-asr-2.0' },
  { platform: 'ark', id: 'doubao-seed-tts-2.0' },
  { platform: 'bailian', id: 'qwen3.8-max' },
  { platform: 'bailian', id: 'qwen-image-3.0-pro' },
  { platform: 'bailian', id: 'wan3.0-video' },
  { platform: 'bailian', id: 'wanx2.1-imageedit' },
  { platform: 'minimax', id: 'MiniMax-M3' },
  { platform: 'minimax', id: 'image-01' },
  { platform: 'minimax', id: 'MiniMax-H3' },
  { platform: 'minimax', id: 'speech-2.8-hd' },
  { platform: 'doubao-speech', id: 'seed-tts-2.0' },
  { platform: 'doubao-speech', id: 'seed-audio-1.0' },
  { platform: 'doubao-speech', id: 'bigmodel' },
  { platform: 'openai', id: 'gpt-6.1-sol' },
  { platform: 'openai', id: 'gpt-image-2.5-sunburst' },
]

// 显式别名：Python 版 MCP 的简称在多个族里同名（如图片与对话都叫 pro），
// 别名又是全局唯一的，所以这里按族指定一个，���余族用完整 ID 或族内别名。
const ALIAS_RULES = [
  { platform: 'ark', id: 'doubao-seed-2-1-pro-260915', alias: 'pro' },
  { platform: 'ark', id: 'doubao-seedance-2-5-260628', alias: 'seedance' },
  { platform: 'ark', id: 'doubao-seedream-5-0-pro-260628', alias: 'seedream-pro' },
  { platform: 'bailian', id: 'qwen3.8-max', alias: 'max' },
  { platform: 'bailian', id: 'qwen-image-3.0-pro', alias: 'qwen' },
  { platform: 'bailian', id: 'wan3.0-video', alias: 'wan' },
]

/** 该模型是不是某个（平台, 能力）的默认模型。 */
function isDefaultModel(platform, id) {
  return DEFAULT_RULES.some((rule) => rule.platform === platform && rule.id === id)
}

/** 逐个模型算出 source.url 与 checkedAt：命中规则用规则页，否则用平台页。 */
function resolveSource(ctx) {
  const rule = SOURCE_RULES.find((r) => r.match(ctx))
  const url = rule?.url ?? PLATFORM_URL[ctx.platform]
  return {
    url,
    checkedAt: rule?.checkedAt ?? SOURCE_CHECKED_AT[url] ?? CHECKED_AT,
  }
}
// docs/inventory.md 第三节已核对的三个官方链接
const MINIMAX_MUSIC_URL = 'https://platform.minimax.cn/docs/api-reference/music-generation'
const ARK_DEPRECATION_URL = 'https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh'
const BAILIAN_TTS_URL = 'https://help.aliyun.com/zh/model-studio/tts-model'

const MCP_FILES = [
  'mcp-minimax.json',
  'mcp-volcengine-ark.json',
  'mcp-ali-bailian.json',
  'mcp-doubao-speech.json',
]
// 任务点名 + MCP 工具清单里能识别到的型号简称词；只有出现在 MCP 清单里的才纳入。
const SHORT_WORD_CANDIDATES = [
  'pro',
  'flash',
  'wan',
  'hd',
  'turbo',
  'max',
  'plus',
  'lite',
  'prime',
  'fast',
  'mini',
  'highspeed',
  'qwen',
  'z',
  'seedance',
  'audio',
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}
function toSlug(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
function toExportName(slug) {
  let name = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
  if (!/^[A-Za-z_$]/.test(name)) name = `m_${name}`
  return name
}

// ── options（zod 内部结构）→ 简单 JSON Schema ─────────────────────────
function toOptionsSchema(options) {
  if (!options || typeof options !== 'object') return undefined
  const shape = options?.def?.shape ?? options?.shape
  if (!shape || typeof shape !== 'object') return undefined
  const properties = {}
  for (const [key, raw] of Object.entries(shape)) {
    const field = raw?.def ?? raw
    const inner = field?.innerType ?? raw?.innerType
    const innerDef = inner?.def ?? inner
    const type = innerDef?.type
    let schema
    switch (type) {
      case 'boolean':
        schema = { type: 'boolean' }
        break
      case 'number':
        schema = { type: 'number' }
        break
      case 'string':
        schema = { type: 'string' }
        break
      case 'enum': {
        const entries = innerDef?.entries ?? inner?.enum
        const values = entries ? Object.keys(entries) : (inner?.options ?? [])
        if (values.length === 0) break
        schema = { type: 'string', enum: values }
        break
      }
      default:
        break
    }
    if (!schema) continue
    const defaultValue = field?.defaultValue
    if (defaultValue !== undefined) schema.default = defaultValue
    properties[key] = schema
  }
  return Object.keys(properties).length > 0 ? { type: 'object', properties } : undefined
}

// ── 从 MCP 工具清单识别出现过的简称词 ─────────────────────────────────
function scanShortWords() {
  const text = MCP_FILES.map((f) => readFileSync(join(MCP_DIR, f), 'utf8'))
    .join('\n')
    .toLowerCase()
  const words = new Set()
  for (const word of SHORT_WORD_CANDIDATES) {
    if (new RegExp(`\\b${word}\\b`).test(text)) words.add(word)
  }
  return [...words].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// 取模型 id 的末段作为型号简称候选（纯数字日期段不算简称）
function shortCandidate(id, words) {
  const tokens = id.split(/[.\-_/ ]+/).filter(Boolean)
  const last = tokens[tokens.length - 1]
  if (!last || /^\d+$/.test(last)) return undefined
  const word = last.toLowerCase()
  return words.includes(word) ? word : undefined
}

// ── TS 字面量序列化（单引号、无分号、行宽 100、trailingComma all）─────
function tsString(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}
function inlineValue(v) {
  if (v === null) return 'null'
  if (typeof v === 'string') return tsString(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(inlineValue).join(', ')}]`
  return `{ ${Object.entries(v)
    .map(([k, val]) => `${safeKey(k)}: ${inlineValue(val)}`)
    .join(', ')} }`
}
function safeKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : tsString(k)
}
// 返回值的渲染字符串（首行不带缩进；多行时换行后用绝对列 indent 缩进）
function emit(v, indent, col) {
  const inline = inlineValue(v)
  if (col + inline.length <= 100) return inline
  // 字符串不拆行：拆了会变成按字符索引的对象
  if (typeof v === 'string') return inline
  if (Array.isArray(v)) {
    const inner = indent + 2
    const lines = v.map((el) => `${' '.repeat(inner)}${emit(el, inner, inner)},`)
    return `[\n${lines.join('\n')}\n${' '.repeat(indent)}]`
  }
  const inner = indent + 2
  const lines = Object.entries(v).map(([k, val]) => {
    const prefix = `${' '.repeat(inner)}${safeKey(k)}: `
    return `${prefix}${emit(val, inner, prefix.length)},`
  })
  return `{\n${lines.join('\n')}\n${' '.repeat(indent)}}`
}

// ── 生命周期规则（逐条对照官方原文，查不到的一律 active + 待核对）─────
const LIFECYCLE_RULES = [
  {
    key: 'minimax/music-3.0',
    match: (c) => c.platform === 'minimax' && c.id === 'music-3.0',
    status: 'closed-to-new-accounts',
    since: '2026-08-20',
    url: MINIMAX_MUSIC_URL,
    note: 'inventory.md 第三节：自 2026-08-20 起付费接口不再向新用户开放，历史付费用户可继续使用；music-3.0 仍是推荐型号',
  },
  {
    key: 'seedream-5.0-lite',
    match: (c) =>
      c.platform === 'ark' &&
      (c.id === 'doubao-seedream-5-0-260128' || c.id === 'doubao-seedream-5-0-lite-260128'),
    status: 'sunsetting',
    sunsetOn: '2026-11-24',
    url: ARK_DEPRECATION_URL,
    note: 'inventory.md 第三节 + 下线公告：停止新购，2026-11-24 14:00（UTC+8）关停',
  },
  {
    key: 'qwen-audio-3.0-tts-flash',
    match: (c) => c.platform === 'bailian' && c.id === 'qwen-audio-3.0-tts-flash',
    status: 'superseded',
    by: 'qwen-audio-3.1-tts-flash',
    url: BAILIAN_TTS_URL,
    note: 'inventory.md 第三节：官方推荐 qwen-audio-3.1-tts-flash，3.0-flash 记为 superseded',
  },
]

function resolveLifecycle(ctx) {
  const rule = LIFECYCLE_RULES.find((r) => r.match(ctx))
  if (rule) {
    const lifecycle = { status: rule.status }
    if (rule.by) lifecycle.by = rule.by
    if (rule.sunsetOn) lifecycle.sunsetOn = rule.sunsetOn
    if (rule.since) lifecycle.since = rule.since
    lifecycle.source = { url: rule.url, checkedAt: SOURCE_CHECKED_AT[rule.url] ?? CHECKED_AT }
    return {
      lifecycle,
      decision: {
        kind: 'rule',
        key: rule.key,
        from: 'deprecated: true',
        to: rule.status,
        url: rule.url,
        note: rule.note,
      },
    }
  }
  const lifecycle = {
    status: 'active',
    source: resolveSource(ctx),
  }
  if (ctx.deprecated) {
    return {
      lifecycle,
      decision: {
        kind: 'pending',
        from: 'deprecated: true',
        to: 'active',
        note: '查不到官方原文，不伪造状态，列为待核对清单',
      },
    }
  }
  return { lifecycle, decision: { kind: 'active', to: 'active' } }
}

// ── 主构建：分组、合并、生成声明对象 ───────────────────────────────────
function buildAll() {
  const providers = readJson(INVENTORY)
  const shortWords = scanShortWords()

  // 1. 按 平台+id 分组（方舟按量/套餐同 id 自然合并）
  const groups = new Map()
  const skippedMock = []
  for (const provider of providers) {
    if (SKIPPED.has(provider.id)) {
      for (const m of provider.models) skippedMock.push(m.id)
      continue
    }
    const mapping = PLATFORM_MAP[provider.id]
    if (!mapping) throw new Error(`未配置的 provider：${provider.id}`)
    for (const model of provider.models) {
      const key = `${mapping.platform}|${model.id}`
      if (!groups.has(key))
        groups.set(key, { platform: mapping.platform, id: model.id, sources: [] })
      groups.get(key).sources.push({ providerId: provider.id, ...mapping, model })
    }
  }

  // 2. slug / 具名导出名（平台内唯一）
  const usedSlugs = new Map()
  const slugNotes = []
  for (const group of groups.values()) {
    const base = toSlug(group.id)
    let slug = base
    let n = 2
    while ((usedSlugs.get(group.platform) ?? new Set()).has(slug)) {
      slug = `${base}-${n++}`
    }
    if (!usedSlugs.has(group.platform)) usedSlugs.set(group.platform, new Set())
    usedSlugs.get(group.platform).add(slug)
    if (slug !== base) slugNotes.push({ platform: group.platform, id: group.id, base, slug })
    group.slug = slug
    group.exportName = toExportName(slug)
  }

  // 3. 简称候选与全局唯一化
  const shortClaims = new Map() // word -> [groupKey]
  for (const [key, group] of groups) {
    const word = shortCandidate(group.id, shortWords)
    if (!word) continue
    if (!shortClaims.has(word)) shortClaims.set(word, [])
    shortClaims.get(word).push(key)
  }
  const adoptedShort = new Map() // groupKey -> [words]
  const omittedShort = []
  for (const [word, keys] of shortClaims) {
    if (keys.length === 1) {
      if (!adoptedShort.has(keys[0])) adoptedShort.set(keys[0], [])
      adoptedShort.get(keys[0]).push(word)
    } else {
      omittedShort.push({
        word,
        owners: keys.map((k) => groups.get(k).id),
        reason: '全局冲突（多个型号共用该简称）',
      })
    }
  }
  for (const word of shortWords) {
    if (!shortClaims.has(word))
      omittedShort.push({
        word,
        owners: [],
        reason: 'MCP 工具清单里是工具级参数别名或无法唯一映射到某个模型',
      })
  }

  // 已占用的 ID / 别名（用于排除冲突的别名）
  const occupied = new Set()
  for (const group of groups.values()) {
    occupied.add(group.id)
    occupied.add(`${PLATFORM_MAP[group.sources[0].providerId].vendor}/${group.id}`)
  }

  // 4. 逐组生成声明
  const declarations = []
  const pendingReview = []
  const ruleApplied = []
  const merged = []
  const officialAliases = []
  const perDeclaration = []

  for (const [key, group] of groups) {
    const sources = group.sources
    // 主来源取方舟按量（volc/ark），其余取第一个
    const primary = sources.find((s) => s.providerId === 'volc/ark') ?? sources[0]
    const model = primary.model
    const platform = group.platform
    const deprecated = sources.some((s) => s.model.deprecated === true)

    // 百炼转售的 MiniMax 型号：canonicalId 用 minimax/<去前缀>，并额外加 minimax 渠道
    const resale = platform === 'bailian' && group.id.startsWith('MiniMax/')
    const canonicalModelId = resale ? group.id.slice('MiniMax/'.length) : group.id
    const vendor = resale ? 'minimax' : primary.vendor
    const canonicalId = `${vendor}/${canonicalModelId}`

    // 原样保留的字段（ModelDeclaration = Omit<ModelSpec,'capabilities'|'deprecated'|'options'>）
    const decl = {}
    decl.canonicalId = canonicalId
    decl.id = model.id
    decl.title = model.title
    decl.capabilities = model.capabilities
    if (model.description !== undefined) decl.description = model.description
    if (model.features !== undefined) decl.features = model.features
    if (model.limits !== undefined) decl.limits = model.limits
    if (model.voices !== undefined) decl.voices = model.voices
    if (model.agentOnly !== undefined) decl.agentOnly = model.agentOnly
    if (model.promptGuide !== undefined) decl.promptGuide = model.promptGuide
    if (model.version !== undefined) decl.version = model.version
    if (model.price !== undefined) decl.price = model.price

    // options → optionsSchema（不写 options / zod 内部字段）
    const optionsSchema = toOptionsSchema(model.options)
    if (optionsSchema) decl.optionsSchema = optionsSchema

    // channels：每个来源一条；方舟按量排前；百炼转售额外加 minimax
    const channelMap = new Map()
    for (const s of sources) channelMap.set(s.channel, { channel: s.channel, id: s.model.id })
    if (resale) channelMap.set('minimax', { channel: 'minimax', id: canonicalModelId })
    decl.channels = [...channelMap.values()].sort((a, b) => a.channel.localeCompare(b.channel))

    // aliases
    const official = []
    if (canonicalId === 'volc/doubao-seedream-5-0-260128') {
      official.push('doubao-seedream-5-0-lite-260128')
      officialAliases.push({
        canonicalId,
        alias: 'doubao-seedream-5-0-lite-260128',
        note: '下线公告里的另一个官方 ID',
      })
    }
    const short = (adoptedShort.get(key) ?? []).filter((w) => !occupied.has(w))
    for (const rule of ALIAS_RULES) {
      if (rule.platform === platform && rule.id === group.id && !short.includes(rule.alias))
        short.push(rule.alias)
    }
    decl.aliases = { official, short }

    // 默认模型：写进声明数据，不在代码里挑
    if (isDefaultModel(platform, group.id)) decl.default = true

    // lifecycle
    const { lifecycle, decision } = resolveLifecycle({
      platform,
      id: group.id,
      deprecated,
      channels: decl.channels.map((c) => c.channel),
    })
    decl.lifecycle = lifecycle
    decl.source = resolveSource({
      platform,
      id: group.id,
      channels: decl.channels.map((c) => c.channel),
    })

    if (decision.kind === 'rule') {
      ruleApplied.push({ canonicalId, id: group.id, ...decision })
    } else if (decision.kind === 'pending') {
      pendingReview.push({
        providerId: primary.providerId,
        id: group.id,
        deprecated: true,
        description: model.description ?? '',
        missingSource: '未找到对应的官方下线/状态公告原文',
        handling: 'lifecycle.status 保持 active，不写入任何非 active 状态',
      })
    }

    // 合并字段差异（仅方舟同 id 两渠道）
    const fieldDiffs = []
    if (sources.length > 1) {
      const compareFields = [
        'title',
        'description',
        'features',
        'limits',
        'voices',
        'agentOnly',
        'capabilities',
        'options',
      ]
      for (const s of sources) {
        if (s === primary) continue
        for (const field of compareFields) {
          const a = JSON.stringify(primary.model[field])
          const b = JSON.stringify(s.model[field])
          if (a !== b) {
            fieldDiffs.push({ field, providerId: s.providerId, primaryValue: a, otherValue: b })
          }
        }
      }
      merged.push({
        id: group.id,
        sources: sources.map((s) => s.providerId),
        channels: decl.channels.map((c) => c.channel),
        primary: primary.providerId,
        fieldDiffs,
      })
    }

    declarations.push({
      key,
      platform,
      slug: group.slug,
      exportName: group.exportName,
      canonicalId,
      decl,
    })
    perDeclaration.push({
      platform,
      slug: group.slug,
      file: `declarations/${platform}/${group.slug}.json`,
      canonicalId,
      id: group.id,
      sources: sources.map((s) => ({ providerId: s.providerId, id: s.model.id })),
      fieldDiffs,
    })
  }

  // 5. 元数据（不含时间戳，保证幂等）
  const platformDist = {}
  for (const platform of PLATFORMS)
    platformDist[platform] = declarations.filter((d) => d.platform === platform).length
  const meta = {
    checkedAt: CHECKED_AT,
    inventory: {
      providers: providers.length,
      models: providers.reduce((n, p) => n + p.models.length, 0),
      mock: skippedMock.length,
      staticModels: providers.reduce((n, p) => n + p.models.length, 0) - skippedMock.length,
    },
    declarations: declarations.length,
    platformDist,
    platformMap: Object.entries(PLATFORM_MAP).map(([providerId, m]) => ({ providerId, ...m })),
    platformUrl: PLATFORM_URL,
    officialLinks: {
      minimaxMusic: MINIMAX_MUSIC_URL,
      arkDeprecation: ARK_DEPRECATION_URL,
      bailianTts: BAILIAN_TTS_URL,
      arkAgentPlan: SOURCE_URL['ark-plan'],
      bailianImage: SOURCE_URL['bailian-image'],
      bailianVideo: SOURCE_URL['bailian-video'],
      minimaxVideo: SOURCE_URL['minimax-video'],
      doubaoSpeechTts: SOURCE_URL['doubao-speech-tts'],
      doubaoSpeechAsr: SOURCE_URL['doubao-speech-asr'],
    },
    // 2026-11-05 没能读到官方正文的页面：这些声明保持原来的核对日期。
    unverified: {
      checkedAt: '2026-11-04',
      note: '这些声明的官方页面正文由前端渲染，2026-11-05 没能读到原文，保持原来的核对日期',
      declarations: [
        'volc/ark-code-latest',
        'volc/custom-chat',
        'volc/custom-image',
        'volc/custom-video',
        'volc/kimi-k2.7-code',
        'volc/minimax-m3',
        'volc/doubao-seedream-5-0-260128',
        'aliyun/qwen3-tts-instruct-flash',
        'doubao/seed-icl-1.0',
      ],
    },
    skippedMock,
    merged,
    lifecycleRules: LIFECYCLE_RULES.map((r) => ({
      key: r.key,
      status: r.status,
      url: r.url,
      note: r.note,
    })),
    ruleApplied,
    pendingReview,
    notTriggered: [
      {
        item: 'qwen-audio-3.0-tts-flash → superseded / qwen-audio-3.1-tts-flash → 默认 / qwen3-tts-flash 不当默认',
        reason:
          'plein 静态清单不含 Qwen-Audio-TTS 3.0/3.1 系列（仅在 MCP 侧），本次无对应声明；默认模型由 core 的 selectDefaultModel() 统一选，声明数据不写死默认标记；qwen3-tts-flash 保持 active。M3 补齐该系列后再落地默认切换。',
      },
    ],
    aliases: {
      shortWords,
      adopted: declarations
        .filter((d) => d.decl.aliases.short.length > 0)
        .map((d) => ({ canonicalId: d.canonicalId, short: d.decl.aliases.short })),
      omitted: omittedShort,
      official: officialAliases,
    },
    fieldTransforms: {
      deprecated: '映射为 lifecycle.status（见生命周期章节），声明不写 deprecated 字段',
      options:
        'zod 内部结构转成 optionsSchema（简单 JSON Schema），声明不写 options / def / innerType',
      added: '新增 canonicalId、channels、aliases、lifecycle、source（0003 要求）',
      capabilities: '沿用 plein 原有 9 种能力，未硬加 0003 新增的归一化能力',
    },
    perDeclaration,
  }

  return { declarations, meta }
}

// ── 写文件 ──────────────────────────────────────────────────────────────
function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function renderTs(decl) {
  return `import type { ModelDeclaration } from '@modelbay/core'\n\nexport default ${emit(decl, 0, 'export default '.length)} satisfies ModelDeclaration\n`
}

function renderIndex(items) {
  const lines = ["import type { ModelDeclaration } from '@modelbay/core'"]
  for (const item of items) lines.push(`import ${item.exportName} from './${item.slug}'`)
  lines.push('')
  lines.push(`export { ${items.map((i) => i.exportName).join(', ')} }`)
  lines.push('')
  lines.push(
    `export const all: ModelDeclaration[] = [${items.map((i) => i.exportName).join(', ')}]`,
  )
  return `${lines.join('\n')}\n`
}

function formatGenerated(paths) {
  const vp = join(root, 'node_modules', '.bin', 'vp')
  if (!existsSync(vp) || paths.length === 0) return false
  try {
    execFileSync(vp, ['fmt', ...paths.map((p) => relative(root, p)), '--write'], {
      cwd: root,
      stdio: 'pipe',
      maxBuffer: 16 * 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}

function writeAll() {
  const { declarations, meta } = buildAll()

  // 不清空目录：M3 之后声明都是手工维护的（补来源、补默认标记、补 MCP 独有的模型），
  // 抽取只补齐缺失的文件，不覆盖已经存在的声明。
  const generated = []
  for (const platform of PLATFORMS) {
    mkdirSync(join(root, 'packages', platform, 'src', 'models'), { recursive: true })
    mkdirSync(join(DECL_DIR, platform), { recursive: true })
  }
  for (const { platform, slug, decl } of declarations) {
    const tsPath = join(root, 'packages', platform, 'src', 'models', `${slug}.ts`)
    const jsonPath = join(DECL_DIR, platform, `${slug}.json`)
    if (!existsSync(tsPath)) {
      writeFile(tsPath, renderTs(decl))
      writeFile(jsonPath, `${JSON.stringify(decl, null, 2)}\n`)
      generated.push(tsPath, jsonPath)
    } else if (!existsSync(jsonPath)) {
      writeFile(jsonPath, `${JSON.stringify(decl, null, 2)}\n`)
      generated.push(jsonPath)
    }
  }
  for (const platform of PLATFORMS) {
    const dir = join(root, 'packages', platform, 'src', 'models')
    const items = declarations
      .filter((d) => d.platform === platform)
      .map((d) => ({ slug: d.slug, exportName: d.exportName }))
    // 目录里已有的手写声明也列进 index.ts
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'index.ts') continue
      const slug = name.replace(/\.ts$/, '')
      if (items.some((item) => item.slug === slug)) continue
      items.push({ slug, exportName: toExportName(slug) })
    }
    const indexPath = join(dir, 'index.ts')
    writeFile(indexPath, renderIndex(items))
    generated.push(indexPath)
  }
  writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`)
  generated.push(META_PATH)

  const formatted = formatGenerated(generated)
  compareRun({ quiet: true })

  console.log(
    `声明抽取完成：${declarations.length} 个声明（${PLATFORMS.map((p) => `${p} ${meta.platformDist[p]}`).join('、')}）；` +
      `mock 跳过 ${meta.skippedMock.length}；待核对 ${meta.pendingReview.length}；` +
      `格式化 ${formatted ? 'vp fmt 已执行' : '未调用（保留手写格式）'}`,
  )
}

if (isMain()) writeAll()
