// 发布前检查：每个可发布包都要过 publint 和 @arethetypeswrong/cli，
// 产物和依赖里不能出现不发布的内部包（装的人拿不到它们）。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bin = (name) => join(root, 'node_modules', '.bin', name)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

const packagesDir = join(root, 'packages')
const problems = []
let checked = 0

const privateNames = new Set(
  readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
    .filter((pkg) => pkg.private)
    .map((pkg) => pkg.name),
)

function* distFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* distFiles(path)
    else if (/\.(mjs|js|d\.mts|d\.ts)$/.test(entry.name)) yield path
  }
}

function privateImports(dir) {
  const found = new Set()
  for (const file of distFiles(join(dir, 'dist'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (privateNames.has(name)) found.add(`${spec}（${file.slice(dir.length + 1)}）`)
    }
  }
  return [...found]
}

for (const name of readdirSync(packagesDir).sort()) {
  const dir = join(packagesDir, name)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.private) continue
  if (!existsSync(join(dir, 'dist'))) {
    problems.push(`${pkg.name}: 没有 dist，先运行 pnpm build`)
    continue
  }
  checked += 1
  // npm 只把包目录里的 LICENSE / README 打进 tarball；provenance 要求 repository 指向发布仓库
  for (const file of ['LICENSE', 'README.md']) {
    if (!existsSync(join(dir, file))) problems.push(`${pkg.name}: 缺少 ${file}`)
  }
  if (pkg.repository?.directory !== `packages/${name}` || !pkg.repository?.url) {
    problems.push(`${pkg.name}: repository.url / repository.directory 缺失或不匹配`)
  }
  const runtimeDeps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }
  for (const dep of Object.keys(runtimeDeps)) {
    if (privateNames.has(dep)) problems.push(`${pkg.name}: 依赖了不发布的内部包 ${dep}`)
  }
  for (const spec of privateImports(dir)) {
    problems.push(`${pkg.name}: 产物导入了不发布的内部包 ${spec}`)
  }
  const publint = run(bin('publint'), [dir])
  if (!publint.ok) problems.push(`${pkg.name}: publint 失败\n${publint.output}`)
  const attw = run(bin('attw'), ['--pack', dir, '--profile', 'esm-only'])
  if (!attw.ok) problems.push(`${pkg.name}: attw 失败\n${attw.output}`)
  console.log(`${pkg.name}: publint ${publint.ok ? 'OK' : 'FAIL'}, attw ${attw.ok ? 'OK' : 'FAIL'}`)
}

if (problems.length > 0) {
  console.error('包发布检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(`包发布检查通过：${checked} 个包`)
}
