// 发布前检查：每个可发布包都要过 publint 和 @arethetypeswrong/cli。
import { existsSync, readFileSync, readdirSync, spawnSync } from 'node:fs'
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
