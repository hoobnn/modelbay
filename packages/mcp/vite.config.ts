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
  pack: {
    entry: [
      'src/index.ts',
      'src/bin/ark-mcp.ts',
      'src/bin/minimax-mcp.ts',
      'src/bin/bailian-mcp.ts',
      'src/bin/doubao-speech-mcp.ts',
    ],
    outDir: 'dist',
    format: 'esm',
    dts: { tsconfig: 'tsconfig.build.json' },
    unbundle: true,
    clean: true,
  },
  // 仅测试期生效：并行开发时 core 的 dist 还是旧的（缺 0003 模块），把裸导入指到 core 源码。
  // 已验证 vp pack 不会应用 test.alias，dist 里仍保留裸 @modelbay/core（整合者重建 core 后即可用）。
  test: { alias: packageAliases },
})
