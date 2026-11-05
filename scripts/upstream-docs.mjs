#!/usr/bin/env node
/**
 * 官方文档 SHA-256 指纹审计。
 *
 * - 读取 `.upstream-docs/declarations/**\/*.json` 里的 `source.url` / `lifecycle.source.url`。
 *   声明的唯一来源是各平台包的 TS 文件，先跑 `vpx -s scripts/export-declarations.ts` 导出。
 * - fail-closed：只允许白名单官方 HTTPS 文档域名；网络缺失 / 抓取失败一律显式报错
 *   并以非零码退出，绝不静默当作「无变化」。
 * - `--check-coverage` 是纯离线模式：
 *   解析声明 JSON，确认每个声明都被官方来源覆盖。
 * - 正常模式抓正文，抽取「可见正文 + 模型标识 + 官方文档链接」等稳定信号后做
 *   SHA-256 指纹，与已审基线比对，输出受影响的模型声明列表。直接哈希 SPA 原始
 *   HTML 会因内嵌的构建哈希 / 随机 token 每次都不同，所以必须先抽取稳定信号。
 * - `--accept-baseline` 仅在全部来源抓取成功后才允许写基线，且变更需人工审核。
 *
 * 只用 Node 内置模块 + 全局 fetch，不引入运行时依赖。不联网的 `--check-coverage`
 * 可离线跑；正常模式缺网络会明确失败。
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 官方文档域名白名单（按后缀匹配，覆盖五家平台的文档站）
const ALLOWED_HOST_SUFFIXES = [
  'volcengine.com',
  'aliyun.com',
  'alibabacloud.com',
  'minimax.cn',
  'minimaxi.com',
  'minimax.io',
  'openai.com',
  'bytedance.com',
]

const MAX_BYTES = 16 * 1024 * 1024
const DATE = /^\d{4}-\d{2}-\d{2}$/

// 按 UTF-16 码位排序，保证指纹在不同环境里完全一致（不用 localeCompare）
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// 从正文里抽取的稳定信号：模型标识与官方文档链接，沿用老脚本的候选标识正则
const MODEL_PATTERN =
  /\b(?:doubao|seedream|seedance|qwen|wan[0-9]|happyhorse|cosyvoice|text-embedding|multimodal-embedding|gte-rerank|seed-tts|seed-icl|volc\.speech|bigmodel|MiniMax-|deepseek-|kimi-|antdigital\/Ling-|xiaomi\/mimo-|speech-2|music-|image-01)[A-Za-z0-9_.-]*/gi
const URL_PATTERN = /https?:\/\/[^\s<>"'`\\]+/g

const USAGE = `用法：node scripts/upstream-docs.mjs [选项]

  --check-coverage          离线：只解析 declarations JSON，校验来源映射（不联网）
  --declarations <dir>      声明目录（默认 .upstream-docs/declarations）
  --baseline <file>         基线 JSON（默认 docs/upstream[/<server>]/baseline.json）
  --output <dir>            输出目录（默认 .upstream-docs）
  --server <name>           只检查一个平台
  --timeout <秒>            单次抓取超时，必须在 (0, 120]（默认 30）
  --accept-baseline         全部抓取成功后写入审阅基线（需人工审核）
  -h, --help                显示帮助
`

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少取值`)
  return value
}

function parseArgs(argv) {
  const args = {
    declarations: join(ROOT, '.upstream-docs', 'declarations'),
    baseline: null,
    output: join(ROOT, '.upstream-docs'),
    server: null,
    checkCoverage: false,
    acceptBaseline: false,
    timeout: 30,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    switch (token) {
      case '--help':
      case '-h':
        args.help = true
        break
      case '--check-coverage':
        args.checkCoverage = true
        break
      case '--accept-baseline':
        args.acceptBaseline = true
        break
      case '--declarations':
        args.declarations = resolve(requireValue(argv, ++index, token))
        break
      case '--baseline':
        args.baseline = resolve(requireValue(argv, ++index, token))
        break
      case '--output':
        args.output = resolve(requireValue(argv, ++index, token))
        break
      case '--server':
        args.server = requireValue(argv, ++index, token)
        break
      case '--timeout':
        args.timeout = Number(requireValue(argv, ++index, token))
        break
      default:
        throw new Error(`未知参数：${token}`)
    }
  }
  if (!(args.timeout > 0 && args.timeout <= 120)) throw new Error('timeout 必须在 (0, 120]')
  return args
}

/** 校验并规范化官方 URL：https、白名单域名、无凭据、标准端口。 */
function officialUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`来源不是合法 URL：${raw}`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`来源必须使用 https：${raw}`)
  if (parsed.username || parsed.password) throw new Error(`来源 URL 不能带凭据：${raw}`)
  if (parsed.port && parsed.port !== '443') throw new Error(`来源端口非标准：${raw}`)
  if (!isOfficialHostname(parsed.hostname)) {
    throw new Error(`来源不在官方域名白名单：${parsed.hostname}`)
  }
  return parsed.href
}

function isOfficialHostname(host) {
  const lower = host.toLowerCase()
  return ALLOWED_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`))
}

function walkJson(directory) {
  const files = []
  if (!existsSync(directory)) return files
  for (const name of readdirSync(directory).sort(compareStrings)) {
    const full = join(directory, name)
    if (statSync(full).isDirectory()) files.push(...walkJson(full))
    else if (name.endsWith('.json')) files.push(full)
  }
  return files
}

function matchesServer(rel, server) {
  const top = rel.split('/')[0]
  return top === server
}

function loadDeclarations(directory, server) {
  const entries = []
  for (const file of walkJson(directory)) {
    const rel = relative(directory, file).split(sep).join('/')
    // `_meta.json` 等下划线开头的文件是导出元数据，不是模型声明
    if ((rel.split('/').pop() ?? '').startsWith('_')) continue
    if (server && !matchesServer(rel, server)) continue
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`声明 JSON 无法解析：${rel}（${error.message}）`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`声明不是对象：${rel}`)
    }
    entries.push({ rel, declaration: parsed })
  }
  return entries
}

/**
 * 离线覆盖检查：解析声明导出的 JSON，确认每个声明都被有效的官方来源覆盖。
 */
function checkCoverage(entries) {
  const problems = []
  for (const { rel, declaration } of entries) {
    const id = declaration.canonicalId ?? rel
    const source = declaration.source
    const lifecycleSource = declaration.lifecycle?.source
    if (!source?.url) problems.push(`${id}: 缺少 source.url`)
    else {
      try {
        officialUrl(source.url)
      } catch (error) {
        problems.push(`${id}: source.url 不合法（${error.message}）`)
      }
    }
    if (!source?.checkedAt || !DATE.test(source.checkedAt)) {
      problems.push(`${id}: source.checkedAt 应为 YYYY-MM-DD`)
    }
    if (!lifecycleSource?.url) problems.push(`${id}: 缺少 lifecycle.source.url`)
    else {
      try {
        officialUrl(lifecycleSource.url)
      } catch (error) {
        problems.push(`${id}: lifecycle.source.url 不合法（${error.message}）`)
      }
    }
    if (!lifecycleSource?.checkedAt || !DATE.test(lifecycleSource.checkedAt)) {
      problems.push(`${id}: lifecycle.source.checkedAt 应为 YYYY-MM-DD`)
    }
  }
  return problems
}

/** 汇总所有官方来源，并记录每个 URL 被哪些声明引用。 */
function collectSources(entries) {
  const byUrl = new Map()
  for (const { rel, declaration } of entries) {
    const id = declaration.canonicalId ?? rel
    const urls = [declaration.source?.url, declaration.lifecycle?.source?.url].filter(
      (value) => typeof value === 'string' && value.length > 0,
    )
    for (const raw of urls) {
      const url = officialUrl(raw)
      let record = byUrl.get(url)
      if (!record) {
        record = { url, declarations: new Set() }
        byUrl.set(url, record)
      }
      record.declarations.add(id)
    }
  }
  return [...byUrl.values()]
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 抽取稳定信号：清洗后的可见正文 + 模型标识 + 官方文档链接；并挡住错误页/外壳。 */
function extractSignals(body, url) {
  const clean = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  const text = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    // 内嵌的构建哈希 / 随机 token 每次请求都不同，归一化掉
    .replace(/[0-9a-f]{16,}/gi, '<hex>')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length < 100) throw new Error(`官方文档正文过短，疑似错误页或外壳：${url}`)
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body.slice(0, 2000))?.[1]?.trim() ?? ''
  if (/^(error|not found|access denied|404|403|forbidden|service unavailable)$/i.test(title)) {
    throw new Error(`抓取到错误页而非文档：${url}`)
  }

  const models = [...new Set(body.match(MODEL_PATTERN) ?? [])].sort(compareStrings)
  const links = [
    ...new Set(
      (body.match(URL_PATTERN) ?? [])
        .map((value) => value.replace(/&amp;/g, '&').replace(/[.,;，。)]+$/, ''))
        .filter((value) => {
          try {
            return isOfficialHostname(new URL(value).hostname)
          } catch {
            return false
          }
        }),
    ),
  ].sort(compareStrings)
  return { text, models, links }
}

/** 对规范化后的稳定信号做 SHA-256，作为该来源的正文指纹。 */
function fingerprint(signals) {
  return sha256(
    JSON.stringify({ text: signals.text, models: signals.models, links: signals.links }),
  )
}

/** 抓取官方正文；手动跟随重定向并逐跳校验，超时/体积超预算即失败。 */
async function fetchOfficial(url, timeoutSeconds) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  let current = officialUrl(url)
  try {
    for (let hop = 0; hop < 8; hop += 1) {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'modelbay-doc-audit/1.0',
          accept: 'text/markdown,application/json,text/plain,text/html;q=0.9',
        },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error(`重定向缺少 Location：${current}`)
        current = officialUrl(new URL(location, current).href)
        continue
      }
      if (!response.ok) throw new Error(`官方文档返回 HTTP ${response.status}：${current}`)
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_BYTES) {
        throw new Error(`官方文档响应超过 16MB 抓取预算：${current}`)
      }
      const body = new TextDecoder('utf-8').decode(buffer)
      return extractSignals(body, current)
    }
    throw new Error(`重定向次数过多：${url}`)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAll(sources, timeout) {
  const records = []
  const errors = []
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= sources.length) return
      const source = sources[index]
      try {
        const signals = await fetchOfficial(source.url, timeout)
        records.push({
          url: source.url,
          sha256: fingerprint(signals),
          bytes: Buffer.byteLength(signals.text, 'utf8'),
          models: signals.models,
          links: signals.links,
          declarations: [...source.declarations].sort(compareStrings),
        })
      } catch (error) {
        errors.push({ url: source.url, error: `${error.name ?? 'Error'}: ${error.message}` })
      }
    }
  }
  const workerCount = Math.min(4, sources.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  records.sort((a, b) => a.url.localeCompare(b.url))
  errors.sort((a, b) => a.url.localeCompare(b.url))
  return { records, errors }
}

function baselinePath(args) {
  if (args.baseline) return args.baseline
  if (args.server) return join(ROOT, 'docs', 'upstream', args.server, 'baseline.json')
  return join(ROOT, 'docs', 'upstream', 'baseline.json')
}

function loadBaseline(path) {
  if (!existsSync(path)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`基线文件无法解析：${path}（${error.message}）`)
  }
  return Array.isArray(parsed.sources) ? parsed.sources : []
}

function diffSet(before, after) {
  const old = new Set(before ?? [])
  const next = new Set(after ?? [])
  return {
    added: [...next].filter((item) => !old.has(item)).sort(compareStrings),
    removed: [...old].filter((item) => !next.has(item)).sort(compareStrings),
  }
}

function compare(records, baseline) {
  const previous = new Map(baseline.map((record) => [record.url, record]))
  const now = new Map(records.map((record) => [record.url, record]))
  const changes = []
  for (const url of [...new Set([...previous.keys(), ...now.keys()])].sort(compareStrings)) {
    const old = previous.get(url)
    const current = now.get(url)
    if (old && current && old.sha256 === current.sha256) continue
    const models = diffSet(old?.models, current?.models)
    const links = diffSet(old?.links, current?.links)
    changes.push({
      url,
      status: !old ? 'added' : !current ? 'removed' : 'changed',
      sha256: current?.sha256 ?? null,
      previousSha256: old?.sha256 ?? null,
      declarations: [...(current?.declarations ?? old?.declarations ?? [])].sort(compareStrings),
      modelsAdded: models.added,
      modelsRemoved: models.removed,
      linksAdded: links.added,
      linksRemoved: links.removed,
    })
  }
  return changes
}

const DIFF_FIELDS = [
  ['modelsAdded', '新增模型标识'],
  ['modelsRemoved', '移除模型标识'],
  ['linksAdded', '新增文档链接'],
  ['linksRemoved', '移除文档链接'],
]

function buildReport(result) {
  const lines = [
    '# 官方文档变更检查',
    '',
    `成功 ${result.sources.length} / ${result.sources.length + result.errors.length}，` +
      `变更 ${result.changes.length}，抓取失败 ${result.errors.length}。`,
    '',
    '正文 SHA-256 指纹变化表示需要重新核对声明，不代表模型已对账号开放或代码必须更新；' +
      '模型标识与链接只是候选，需按官方模型表确认。',
    '',
  ]
  if (result.changes.length === 0) {
    lines.push('本次没有检测到官方文档变化。', '')
  } else {
    lines.push('## 变更与受影响的模型声明', '')
    for (const change of result.changes) {
      lines.push(`- **${change.status}** ${change.url}`)
      lines.push(`  - 声明：${change.declarations.join(', ') || '（无）'}`)
      for (const [field, label] of DIFF_FIELDS) {
        if (change[field].length > 0) lines.push(`  - ${label}：${change[field].join(', ')}`)
      }
    }
    lines.push('')
  }
  if (result.errors.length > 0) {
    lines.push('## 抓取失败（fail-closed，拒绝更新基线）', '')
    for (const error of result.errors) lines.push(`- ${error.url}: ${error.error}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function emitGithubOutput(changes, errors, affected) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  appendFileSync(
    file,
    `changed=${changes.length > 0}\naffected=${affected}\nerrors=${errors.length}\n`,
  )
}

async function runAudit(args, sources) {
  const baselineRecords = loadBaseline(baselinePath(args))
  const { records, errors } = await fetchAll(sources, args.timeout)

  // 抓取失败的来源保留旧指纹，避免被误判成「文档被移除」；同时拒绝更新基线
  const failed = new Set(errors.map((error) => error.url))
  const retained = baselineRecords.filter((record) => failed.has(record.url))
  const changes = compare([...records, ...retained], baselineRecords)

  const result = {
    formatVersion: 1,
    checkedAt: new Date().toISOString(),
    server: args.server ?? null,
    sources: records,
    changes,
    errors,
  }

  mkdirSync(args.output, { recursive: true })
  writeFileSync(join(args.output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(join(args.output, 'report.md'), buildReport(result))

  const affected = new Set(changes.flatMap((change) => change.declarations)).size
  process.stdout.write(
    `sources=${records.length}/${sources.length} changes=${changes.length} ` +
      `errors=${errors.length} affected=${affected}\n`,
  )
  if (errors.length > 0) {
    process.stderr.write(
      `官方文档抓取失败 ${errors.length} 个（fail-closed）：网络缺失或来源不可达，不静默通过。\n`,
    )
    for (const error of errors) process.stderr.write(`  ${error.url}: ${error.error}\n`)
  }
  emitGithubOutput(changes, errors, affected)

  if (args.acceptBaseline) {
    if (errors.length > 0) {
      process.stderr.write('拒绝更新基线：仍有抓取失败的来源，请人工核对后再试。\n')
    } else {
      const path = baselinePath(args)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(
        path,
        `${JSON.stringify(
          { formatVersion: 1, reviewedAt: result.checkedAt, sources: records },
          null,
          2,
        )}\n`,
      )
      process.stdout.write(`已写入审阅基线：${path}（请人工审核后再合并）\n`)
    }
  }

  // fail-closed：任何抓取失败 / 网络缺失都以非零码退出，绝不静默通过
  if (errors.length > 0) process.exitCode = 1
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`参数错误：${error.message}\n\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (args.help) {
    process.stdout.write(USAGE)
    return
  }

  let entries
  try {
    entries = loadDeclarations(args.declarations, args.server)
  } catch (error) {
    process.stderr.write(`声明读取失败：${error.message}\n`)
    process.exitCode = 1
    return
  }
  if (entries.length === 0) {
    const scope = args.server ? `（平台 ${args.server}）` : ''
    process.stderr.write(
      `未找到声明 JSON${scope}；先运行 vpx -s scripts/export-declarations.ts，拒绝静默通过。\n`,
    )
    process.exitCode = 1
    return
  }

  // 离线模式也要先做覆盖检查（解析声明 JSON，不联网）
  const problems = checkCoverage(entries)
  if (args.checkCoverage) {
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`- ${problem}\n`)
      process.stderr.write(`官方文档来源映射不完整：${problems.length} 处问题。\n`)
      process.exitCode = 1
      return
    }
    const sources = collectSources(entries)
    process.stdout.write(
      `官方文档来源映射覆盖全部声明（${entries.length} 个声明，${sources.length} 个去重来源）。\n`,
    )
    return
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`- ${problem}\n`)
    process.stderr.write(`官方文档来源映射不完整：${problems.length} 处问题。\n`)
    process.exitCode = 1
    return
  }

  await runAudit(args, collectSources(entries))
}

main().catch((error) => {
  process.stderr.write(`审计失败：${error.message}\n`)
  process.exitCode = 1
})
