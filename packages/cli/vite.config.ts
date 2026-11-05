import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// vitest 的 projects 模式不继承根配置的 alias：测试阶段直接解析到源码，不需要先 build。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageAliases = [
  { find: '@modelbay/ark/tos', replacement: `${repoRoot}packages/ark/src/node/index.ts` },
  {
    find: '@modelbay/bailian/image-edit',
    replacement: `${repoRoot}packages/bailian/src/node/image-edit.ts`,
  },
  { find: '@modelbay/core/provider', replacement: `${repoRoot}packages/core/src/provider.ts` },
  {
    find: '@modelbay/core/model-params',
    replacement: `${repoRoot}packages/core/src/model-params.ts`,
  },
  {
    find: '@modelbay/core/media-requirements',
    replacement: `${repoRoot}packages/core/src/media-requirements.ts`,
  },
  {
    find: '@modelbay/core/image-input',
    replacement: `${repoRoot}packages/core/src/image-input.ts`,
  },
  {
    find: '@modelbay/core/video-input',
    replacement: `${repoRoot}packages/core/src/video-input.ts`,
  },
  { find: '@modelbay/core/ids', replacement: `${repoRoot}packages/core/src/ids.ts` },
  { find: '@modelbay/core/ports', replacement: `${repoRoot}packages/core/src/ports.ts` },
  { find: '@modelbay/core/media', replacement: `${repoRoot}packages/core/src/media.ts` },
  {
    find: '@modelbay/core/reference-tokens',
    replacement: `${repoRoot}packages/core/src/reference-tokens.ts`,
  },
  {
    find: '@modelbay/core/capabilities',
    replacement: `${repoRoot}packages/core/src/capabilities.ts`,
  },
  {
    find: '@modelbay/core/declarations',
    replacement: `${repoRoot}packages/core/src/declarations.ts`,
  },
  { find: '@modelbay/core/schema', replacement: `${repoRoot}packages/core/src/schema.ts` },
  { find: '@modelbay/core/runtime', replacement: `${repoRoot}packages/core/src/runtime.ts` },
  { find: '@modelbay/core/adapter', replacement: `${repoRoot}packages/core/src/adapter.ts` },
  {
    find: '@modelbay/doubao-speech/asr',
    replacement: `${repoRoot}packages/doubao-speech/src/node/asr.ts`,
  },
  {
    find: '@modelbay/doubao-speech/interpretation',
    replacement: `${repoRoot}packages/doubao-speech/src/node/interpretation.ts`,
  },
  { find: '@modelbay/openai/node', replacement: `${repoRoot}packages/openai/src/node/index.ts` },
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
