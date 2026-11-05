// 依赖许可检查：运行时依赖只允许 MIT / Apache-2.0 / BSD / ISC（及其等价写法）。
// dependencies 与 peerDependencies 都要检查（可选 peer 也是集成方会装进产物的东西）；
// workspace 内部包按自己的 license 字段检查；devDependencies 不进发布产物，不检查。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
])

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function packageDirs() {
  const dirs = [root]
  const packages = join(root, 'packages')
  if (existsSync(packages)) {
    for (const name of readdirSync(packages)) {
      if (readJson(join(packages, name, 'package.json'))) dirs.push(join(packages, name))
    }
  }
  return dirs
}

function licenseOf(name) {
  const candidates = [join(root, 'node_modules', name, 'package.json')]
  for (const dir of packageDirs()) {
    candidates.push(join(dir, 'node_modules', name, 'package.json'))
  }
  for (const path of candidates) {
    const pkg = readJson(path)
    if (!pkg) continue
    const value = pkg.license ?? pkg.licenses
    if (typeof value === 'string') return value
    if (Array.isArray(value))
      return value.map((item) => (typeof item === 'string' ? item : item.type)).join(' OR ')
    if (value && typeof value.type === 'string') return value.type
    return '(unknown)'
  }
  return null
}

const problems = []
const seen = new Set()
for (const dir of packageDirs()) {
  const pkg = readJson(join(dir, 'package.json'))
  if (!pkg) continue
  const runtime = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]
  for (const name of runtime) {
    if (seen.has(name)) continue
    seen.add(name)
    const license = licenseOf(name)
    if (license === null) {
      problems.push(`${name}: 找不到已安装的包，先运行 pnpm install`)
    } else if (!ALLOWED.has(license)) {
      problems.push(`${name}: 许可 ${license} 不在允许列表（MIT / Apache-2.0 / BSD / ISC）`)
    }
  }
}

if (problems.length > 0) {
  console.error('依赖许可检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(`依赖许可检查通过：${seen.size} 个运行时依赖`)
}
