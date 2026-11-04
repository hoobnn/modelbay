// M1 验收：core 不绑定运行时。
// 1) 源码不能出现 node: 导入或 Node 专属全局 / 依赖；
// 2) tsconfig 必须把 types 置空、lib 只留各运行时都有的部分。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const coreDir = join(root, 'packages/core')
const srcDir = join(coreDir, 'src')

const FORBIDDEN_IMPORTS = ['node:', 'sharp', 'fs', 'path', '@volcengine/tos-sdk']
const FORBIDDEN_GLOBALS = [/\bBuffer\b/, /\bprocess\./, /\b__dirname\b/, /\brequire\(/]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (name.endsWith('.ts') || name.endsWith('.mts')) out.push(path)
  }
  return out
}

const problems = []
const files = walk(srcDir)
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(root, file)
  for (const line of text.split('\n')) {
    const match = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/.exec(line)
    if (match && FORBIDDEN_IMPORTS.some((bad) => match[1] === bad || match[1].startsWith(bad))) {
      problems.push(`${rel}: 不允许导入 ${match[1]}`)
    }
  }
  // 声明与注释里提到这些词不算，只检查非注释行
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const pattern of FORBIDDEN_GLOBALS) {
    if (pattern.test(code)) problems.push(`${rel}: 不允许使用 ${pattern.source}`)
  }
}

const tsconfig = JSON.parse(readFileSync(join(coreDir, 'tsconfig.json'), 'utf8'))
const opts = tsconfig.compilerOptions ?? {}
if (!Array.isArray(opts.types) || opts.types.length !== 0) {
  problems.push('packages/core/tsconfig.json: compilerOptions.types 必须是 []')
}
const lib = Array.isArray(opts.lib) ? opts.lib : []
if (!lib.includes('DOM') || lib.some((item) => !['ES2023', 'DOM', 'DOM.Iterable'].includes(item))) {
  problems.push('packages/core/tsconfig.json: lib 只能是 ES2023 / DOM / DOM.Iterable')
}

if (problems.length > 0) {
  console.error('core 运行时隔离检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(`core 运行时隔离检查通过：${files.length} 个源文件，无 Node 专属 API`)
}
