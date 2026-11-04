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
    // commands / deps / main 是 index.ts 的内部依赖，单独列出来只是为了让
    // dist 里每个模块都带上对应的 .d.mts；对外只暴露 "." 这一条。
    entry: ['src/index.ts', 'src/cli.ts', 'src/commands.ts', 'src/deps.ts', 'src/main.ts'],
    outDir: 'dist',
    format: 'esm',
    dts: { tsconfig: 'tsconfig.build.json' },
    unbundle: true,
    clean: true,
  },
})
