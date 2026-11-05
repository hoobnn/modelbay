// 按包行覆盖率门槛：core 不低于 90%，其余每个包不低于 80%。
// 数据来自 `vp test run --coverage` 产出的 coverage/coverage-summary.json。
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const summaryPath = join(root, 'coverage', 'coverage-summary.json')
if (!existsSync(summaryPath)) {
  console.error('找不到 coverage/coverage-summary.json，请先运行 pnpm test:coverage')
  process.exit(1)
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
const groups = new Map()
for (const [file, data] of Object.entries(summary)) {
  if (file === 'total' || !data?.lines) continue
  const rel = relative(root, file).split(sep)
  if (rel[0] !== 'packages' || rel[2] !== 'src') continue
  const name = rel[1]
  const entry = groups.get(name) ?? { covered: 0, total: 0, files: 0 }
  entry.covered += data.lines.covered
  entry.total += data.lines.total
  entry.files += 1
  groups.set(name, entry)
}

const thresholdOf = (name) => (name === 'core' ? 90 : 80)

const problems = []
const rows = []
for (const [name, entry] of [...groups.entries()].sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0,
)) {
  const pct = entry.total === 0 ? 100 : (entry.covered / entry.total) * 100
  const threshold = thresholdOf(name)
  rows.push(
    `  ${name.padEnd(16)} ${pct.toFixed(1).padStart(5)}%  (${entry.covered}/${entry.total} 行, ${entry.files} 文件, 门槛 ${threshold}%)`,
  )
  if (pct + 1e-9 < threshold) {
    problems.push(`${name} 行覆盖 ${pct.toFixed(1)}% 低于 ${threshold}%`)
  }
}

console.log('按包行覆盖率：')
for (const row of rows) console.log(row)
if (problems.length > 0) {
  console.error('覆盖率门槛检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log('覆盖率门槛检查通过')
}
