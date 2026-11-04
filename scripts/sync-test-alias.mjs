// 幂等地给每个包注入统一的 vitest alias。
// vitest 的 projects 模式不继承根 vite.config.ts 的 alias，因此每个包自己声明一份；
// 只放在 test 段，vp pack 不受影响，产物仍引用已发布的 @modelbay/*。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = join(root, 'packages')

const consts = `// vitest 的 projects 模式不继承根配置的 alias：测试阶段直接解析到源码，不需要先 build。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageAliases = [
  { find: /^@modelbay\\/core\\/([\\w-]+)$/, replacement: \`\${repoRoot}packages/core/src/$1.ts\` },
  { find: /^@modelbay\\/([\\w-]+)$/, replacement: \`\${repoRoot}packages/$1/src/index.ts\` },
  { find: /^modelbay$/, replacement: \`\${repoRoot}packages/modelbay/src/index.ts\` },
]

`

let changed = 0
for (const name of readdirSync(packagesDir).sort()) {
  const file = join(packagesDir, name, 'vite.config.ts')
  if (!existsSync(file)) continue
  let text = readFileSync(file, 'utf8')

  const lines = text.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('test: {')) {
      if (line.includes('alias: packageAliases')) {
        out.push(line)
        i += 1
        continue
      }
      while (i < lines.length && lines[i] !== '  },') i += 1
      if (i < lines.length) i += 1
      out.push('  test: { alias: packageAliases },')
      continue
    }
    out.push(line)
    i += 1
  }
  text = out.join('\n')

  if (!text.includes('test: { alias: packageAliases }')) {
    text = text.replace(
      'export default defineConfig({',
      'export default defineConfig({\n  test: { alias: packageAliases },',
    )
  }
  if (!text.includes('const packageAliases')) {
    text = text.replace('export default defineConfig({', `${consts}export default defineConfig({`)
  }
  if (!text.includes("from 'node:url'")) {
    text = `import { fileURLToPath } from 'node:url'\n${text}`
  }

  const before = readFileSync(file, 'utf8')
  if (before !== text) {
    writeFileSync(file, text)
    changed += 1
    console.log(`  ${name}: alias 已同步`)
  }
}
console.log(`test alias 同步完成，改动 ${changed} 个包`)
