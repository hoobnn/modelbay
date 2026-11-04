// 声明自检：TS/JSON 声明都是纯数据、带官方来源与核对日期、生命周期状态合法、
// 能生成合法 JSON Schema、别名不冲突、非 active 不能当默认。
// 复刻 core/schema.ts 的 declarationJsonSchema()/isValidJsonSchema() 思路做纯 JS 校验，
// .mjs 不直接 import TS 源码，也不强依赖 zod（未安装时也能稳定通过）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = join(root, 'packages')
const declDir = join(root, 'declarations')
const STATUSES = new Set([
  'active',
  'superseded',
  'sunsetting',
  'closed-to-new-accounts',
  'retired',
])
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CAPABILITY_INPUT = {
  'text.chat': { type: 'object', properties: { messages: { type: 'array' } } },
  'image.generate': { type: 'object', properties: { prompt: { type: 'string' } } },
  'image.edit': { type: 'object', properties: { image: { type: 'string' } } },
  'image.process': { type: 'object', properties: { image: { type: 'string' } } },
  'video.generate': { type: 'object', properties: { prompt: { type: 'string' } } },
  'audio.speech': { type: 'object', properties: { text: { type: 'string' } } },
  'audio.music': { type: 'object', properties: { prompt: { type: 'string' } } },
  'audio.sfx': { type: 'object', properties: { prompt: { type: 'string' } } },
  'audio.transcribe': { type: 'object', properties: { audio: { type: 'string' } } },
  'voice.clone': { type: 'object', properties: { voiceId: { type: 'string' } } },
  'voice.design': { type: 'object', properties: { voiceId: { type: 'string' } } },
  'voice.list': { type: 'object', properties: {} },
  'text.embed': { type: 'object', properties: { input: { type: 'array' } } },
}

function walk(dir, match, skip) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    // pnpm workspace 的 node_modules 里有指向各包的符号链接，跳避免重复计入
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue
    if (skip(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path, match, skip))
    else if (match(name)) out.push(path)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// 去掉字符串字面量，避免 URL 里的 // ? 干扰「纯数据」判断
function stripStrings(text) {
  return text.replace(/'(?:\\.|[^'\\])*'/g, "''")
}

// 复刻 core/schema.ts：声明 → 可序列化的 object schema
function declarationJsonSchema(decl) {
  const primary = decl.capabilities?.[0] ?? 'text.chat'
  const properties = {
    model: { type: 'string' },
    capability: { type: 'string' },
    input: CAPABILITY_INPUT[primary] ?? { type: 'object' },
    extra: { type: 'object' },
    ...decl.optionsSchema?.properties,
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: decl.title,
    properties,
    required: ['model', 'capability', 'input'],
    additionalProperties: true,
  }
}
function isValidJsonSchema(schema) {
  try {
    const parsed = JSON.parse(JSON.stringify(schema))
    return (
      parsed.type === 'object' &&
      parsed.properties &&
      typeof parsed.properties === 'object' &&
      !Array.isArray(parsed.properties)
    )
  } catch {
    return false
  }
}

function hasZodInternals(value) {
  if (!value || typeof value !== 'object') return false
  for (const [key, child] of Object.entries(value)) {
    if (['def', 'innerType', '_zod', 'shape', 'checks', 'entries'].includes(key)) return true
    if (hasZodInternals(child)) return true
  }
  return false
}

const problems = []
// 只遍历每个顶层包的 src/models，避免进入 packages/*/node_modules 的符号链接副本
const tsFiles = []
if (existsSync(packagesDir)) {
  for (const pkg of readdirSync(packagesDir).sort()) {
    tsFiles.push(
      ...walk(
        join(packagesDir, pkg, 'src', 'models'),
        (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'index.ts',
        () => false,
      ),
    )
  }
}
const jsonFiles = walk(
  declDir,
  (n) => n.endsWith('.json'),
  (n) => n.startsWith('_'),
)

// 没有 declarations 目录（M2 之前）或没有任何声明：跳过并退出 0
if (!existsSync(declDir) || (jsonFiles.length === 0 && tsFiles.length === 0)) {
  console.log('声明自检：暂无声明文件（跳过）')
  process.exit(0)
}

// ── 1. TS 静态检查（保留原有检查，satisfies 改为 ModelDeclaration）─────
const tsAliases = new Map()
for (const file of tsFiles) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  if (!/export default \{[\s\S]*\}\s+satisfies\s+ModelDeclaration/.test(text)) {
    problems.push(`${rel}: 必须写成 export default { ... } satisfies ModelDeclaration`)
  }
  const code = stripStrings(text).replace(/\/\/[^\n]*/g, '')
  if (/\bfunction\b|\bif\s*\(|=>|\?[^:\n]*:/.test(code)) {
    problems.push(`${rel}: 声明里不允许函数、条件分支或计算值`)
  }
  if (!/source:\s*\{[^}]*url:/s.test(text)) problems.push(`${rel}: 缺少 source.url`)
  if (!/checkedAt:\s*'\d{4}-\d{2}-\d{2}'/.test(text)) {
    problems.push(`${rel}: 缺少合法格式（YYYY-MM-DD）的 checkedAt`)
  }
  const status = /status:\s*'([a-z-]+)'/.exec(text)
  if (status && !STATUSES.has(status[1])) problems.push(`${rel}: 未知生命周期状态 ${status[1]}`)
  // 仅检查顶层（2 空格缩进）的默认标记，避免 optionsSchema 内的 default 干扰
  if (/^  default:\s*true/m.test(text) && status && status[1] !== 'active') {
    problems.push(`${rel}: 非 active 模型不能当默认模型`)
  }
  const aliasBlock = /aliases:\s*\{([\s\S]*?)\}/.exec(text)
  if (aliasBlock) {
    const owner = /canonicalId:\s*'([^']+)'/.exec(text)?.[1] ?? rel
    for (const match of aliasBlock[1].matchAll(/'([^']+)'/g)) {
      const alias = match[1]
      const current = tsAliases.get(alias)
      if (current && current !== owner)
        problems.push(`别名 ${alias} 在 ${current} 和 ${owner} 重复`)
      else tsAliases.set(alias, owner)
    }
  }
}

// ── 2. JSON 声明检查 ────────────────────────────────────────────────────
const jsonDecls = []
for (const file of jsonFiles) {
  const rel = relative(root, file)
  let decl
  try {
    decl = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(`${rel}: 不是合法 JSON（${error.message}）`)
    continue
  }
  jsonDecls.push({ rel, decl })

  // 纯数据：JSON.parse 天然不含函数/计算值；显式禁止被 Omit 的字段
  if ('deprecated' in decl) problems.push(`${rel}: 不应写入 deprecated（改用 lifecycle）`)
  if ('options' in decl) problems.push(`${rel}: 不应写入 options（改用 optionsSchema）`)

  // 必填字段
  if (typeof decl.canonicalId !== 'string' || !decl.canonicalId.includes('/')) {
    problems.push(`${rel}: canonicalId 应为 厂商/模型`)
  }
  if (!decl.title) problems.push(`${rel}: 缺少 title`)
  if (!Array.isArray(decl.capabilities) || decl.capabilities.length === 0) {
    problems.push(`${rel}: 没有声明能力`)
  }
  if (!Array.isArray(decl.channels) || decl.channels.length === 0) {
    problems.push(`${rel}: 至少要有一个渠道`)
  } else {
    for (const channel of decl.channels) {
      if (!channel.channel || !channel.id) problems.push(`${rel}: 渠道缺少 channel 或 id`)
    }
  }

  // source / lifecycle.source
  if (!decl.source?.url?.startsWith('https://'))
    problems.push(`${rel}: source.url 缺失或不是 https 链接`)
  if (!DATE.test(decl.source?.checkedAt ?? ''))
    problems.push(`${rel}: source.checkedAt 应为 YYYY-MM-DD`)
  if (!decl.lifecycle?.source?.url?.startsWith('https://')) {
    problems.push(`${rel}: lifecycle.source.url 缺失或不是 https 链接`)
  }
  if (!DATE.test(decl.lifecycle?.source?.checkedAt ?? '')) {
    problems.push(`${rel}: lifecycle.source.checkedAt 应为 YYYY-MM-DD`)
  }

  // 生命周期状态
  const status = decl.lifecycle?.status
  if (!STATUSES.has(status)) problems.push(`${rel}: 未知的生命周期状态 ${status}`)
  if (status === 'superseded' && !decl.lifecycle?.by) {
    problems.push(`${rel}: superseded 需要记录 by`)
  }
  // 非 active 不能当默认（声明不写死默认；若出现默认标记必须 active）
  if (status !== 'active' && (decl.default === true || decl.isDefault === true)) {
    problems.push(`${rel}: 非 active 模型不能当默认模型`)
  }

  // optionsSchema：必须是简单 object schema，且不含 zod 内部字段
  if (decl.optionsSchema !== undefined) {
    const schema = decl.optionsSchema
    if (schema?.type !== 'object' || !schema?.properties || typeof schema.properties !== 'object') {
      problems.push(`${rel}: optionsSchema 应为 { type: 'object', properties: {...} }`)
    } else {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (!prop || typeof prop !== 'object' || !prop.type) {
          problems.push(`${rel}: optionsSchema.${name} 缺少 type`)
        }
      }
    }
    if (hasZodInternals(schema)) {
      problems.push(`${rel}: optionsSchema 不应保留 zod 内部字段（def/innerType 等）`)
    }
  }

  // 能用 core 的 schema 思路生成合法 JSON Schema
  const generated = declarationJsonSchema(decl)
  if (!isValidJsonSchema(generated)) {
    problems.push(`${rel}: 生成的 JSON Schema 不合法（type 应为 object、properties 应为对象）`)
  }
}

// ── 3. 全局别名不冲突（JSON 为准）─────────────────────────────────────
const aliasOwners = new Map()
const occupied = new Set()
for (const { decl } of jsonDecls) {
  occupied.add(decl.id)
  occupied.add(decl.canonicalId)
  for (const channel of decl.channels ?? []) occupied.add(channel.id)
}
for (const { rel, decl } of jsonDecls) {
  const aliases = [...(decl.aliases?.official ?? []), ...(decl.aliases?.short ?? [])]
  const seen = new Set()
  for (const alias of aliases) {
    if (seen.has(alias)) problems.push(`${rel}: 同一声明内别名 ${alias} 重复`)
    seen.add(alias)
    if (occupied.has(alias)) problems.push(`${rel}: 别名 ${alias} 与某个模型 id / 渠道 id 冲突`)
    const owner = aliasOwners.get(alias)
    if (owner && owner !== decl.canonicalId) {
      problems.push(`别名 ${alias} 在 ${owner} 和 ${decl.canonicalId} 重复`)
    } else {
      aliasOwners.set(alias, decl.canonicalId)
    }
  }
}

if (problems.length > 0) {
  console.error('声明自检失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(
    `声明自检通过：${tsFiles.length} 个 TS 声明、${jsonDecls.length} 个 JSON 声明，` +
      `${aliasOwners.size} 个别名，无冲突`,
  )
}
