import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// 只发 ESM，保留源码文件结构，让每个子路径都有独立的 .js / .d.ts。
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
    entry: [
      'src/index.ts',
      'src/provider.ts',
      'src/model-params.ts',
      'src/media-requirements.ts',
      'src/image-input.ts',
      'src/video-input.ts',
      'src/ids.ts',
      'src/ports.ts',
      'src/media.ts',
      'src/reference-tokens.ts',
      'src/capabilities.ts',
      'src/declarations.ts',
      'src/schema.ts',
      'src/runtime.ts',
      'src/adapter.ts',
    ],
    outDir: 'dist',
    format: 'esm',
    dts: true,
    unbundle: true,
    clean: true,
  },
})
