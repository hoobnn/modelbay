/**
 * 把注册表里全部平台的模型声明导出成 JSON，供 `upstream-docs.mjs` 抓官方来源比对指纹。
 *
 * 声明的唯一来源是各平台包 `src/models/*.ts`；导出物只是临时产物，写到
 * `.upstream-docs/declarations/<平台>/<模型>.json`（已 gitignore），不进仓库。
 *
 * 用法：`vpx -s scripts/export-declarations.ts [输出目录]`
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModelDeclaration } from '@modelbay/core'
import { PLATFORMS } from '../packages/modelbay/src/platforms'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(process.argv[2] ?? join(root, '.upstream-docs/declarations'))

rmSync(outDir, { recursive: true, force: true })
let total = 0
for (const platform of PLATFORMS) {
  const seen = new Map<string, ModelDeclaration>()
  for (const adapter of platform.createAdapters()) {
    for (const declaration of adapter.models) seen.set(declaration.canonicalId, declaration)
  }
  const dir = join(outDir, platform.key)
  mkdirSync(dir, { recursive: true })
  for (const declaration of seen.values()) {
    writeFileSync(join(dir, `${declaration.id}.json`), `${JSON.stringify(declaration, null, 2)}\n`)
  }
  total += seen.size
}
process.stdout.write(`已导出 ${total} 个声明到 ${outDir}\n`)
