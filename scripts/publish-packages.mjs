// 发布三个对外包：只在 release.yml 里运行，靠 npm trusted publishing（OIDC）鉴权，不用长期 token。
//
// 不用 `changeset publish`：它走 `pnpm publish`，npm 只给 npm CLI 文档化了 OIDC 和自动 provenance。
// 这里先 `pnpm pack`（把 `workspace:*` 换成真实版本号），再用 `npm publish <tarball>` 上传。
// 已经在 npm 上的版本跳过，所以重跑是安全的。加 `--dry-run` 只打包和预演，不上传。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dryRun = process.argv.includes('--dry-run')

/** 依赖在前：mcp、cli 依赖 modelbay，先发 modelbay。 */
const ORDER = ['modelbay', '@modelbay/mcp', '@modelbay/cli']

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const npmVersion = run('npm', ['--version']).stdout.trim()
const [major, minor, patch] = npmVersion.split('.').map(Number)
if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
  console.error(`trusted publishing 需要 npm CLI 11.5.1 以上，当前是 ${npmVersion}`)
  process.exit(1)
}

const packagesDir = join(root, 'packages')
const publishable = readdirSync(packagesDir)
  .map((name) => join(packagesDir, name))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter(({ pkg }) => !pkg.private)

const unknown = publishable.filter(({ pkg }) => !ORDER.includes(pkg.name))
if (unknown.length > 0) {
  console.error(`未登记发布顺序的包：${unknown.map(({ pkg }) => pkg.name).join('、')}`)
  process.exit(1)
}
publishable.sort((a, b) => ORDER.indexOf(a.pkg.name) - ORDER.indexOf(b.pkg.name))

const outDir = mkdtempSync(join(tmpdir(), 'modelbay-publish-'))
let failed = false
for (const { dir, pkg } of publishable) {
  const spec = `${pkg.name}@${pkg.version}`
  const existing = run('npm', ['view', spec, 'version'])
  if (existing.ok && existing.stdout.trim() === pkg.version) {
    console.log(`${spec}：npm 上已有，跳过`)
    continue
  }
  const packed = run('pnpm', ['pack', '--pack-destination', outDir], { cwd: dir })
  // pnpm pack 的文件名：去掉 @、把 / 换成 -，再接版本号
  const tarball = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
  if (!packed.ok || !existsSync(join(outDir, tarball))) {
    console.error(`${spec}：打包失败\n${packed.stdout}${packed.stderr}`)
    failed = true
    break
  }
  // 预发布版本（如 0.2.0-beta.1）npm 要求显式 tag，发到 next，不占 latest
  const tag = pkg.version.includes('-') ? ['--tag', 'next'] : []
  const args = [
    'publish',
    join(outDir, tarball),
    '--access',
    'public',
    ...tag,
    ...(dryRun ? ['--dry-run'] : []),
  ]
  const published = run('npm', args, { stdio: 'inherit' })
  if (!published.ok) {
    console.error(`${spec}：发布失败`)
    failed = true
    break
  }
  console.log(`${spec}：${dryRun ? '预演通过（未上传）' : '已发布'}`)
}
process.exitCode = failed ? 1 : 0
