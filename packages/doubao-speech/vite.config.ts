import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// vitest 的 projects 模式不继承根配置的 alias：测试阶段直接解析到源码，不需要先 build。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageAliases = [
  { find: /^@modelbay\/core\/([\w-]+)$/, replacement: `${repoRoot}packages/core/src/$1.ts` },
  { find: /^@modelbay\/([\w-]+)$/, replacement: `${repoRoot}packages/$1/src/index.ts` },
  { find: /^modelbay$/, replacement: `${repoRoot}packages/modelbay/src/index.ts` },
]

export default defineConfig({
  test: { alias: packageAliases },
  pack: {
    entry: ['src/index.ts', 'src/node/asr.ts'],
    outDir: 'dist',
    format: 'esm',
    dts: { tsconfig: 'tsconfig.build.json' },
    unbundle: true,
    clean: true,
  },
})
