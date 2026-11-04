import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// vitest 的 projects 模式不继承根配置的 alias：每个包自己声明一份，
// 测试阶段直接解析到源码，不需要先 build。放在 test 段，不影响 vp pack。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageAliases = [
  { find: /^@modelbay\/core\/([\w-]+)$/, replacement: `${repoRoot}packages/core/src/$1.ts` },
  { find: /^@modelbay\/([\w-]+)$/, replacement: `${repoRoot}packages/$1/src/index.ts` },
  { find: /^modelbay$/, replacement: `${repoRoot}packages/modelbay/src/index.ts` },
]

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: 'esm',
    dts: true,
    unbundle: true,
    clean: true,
  },
  test: { alias: packageAliases },
})
