import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// verify 里 test 排在 build 之前：测试阶段直接解析到各包源码，不依赖 dist。
const packagesRoot = fileURLToPath(new URL('./packages/', import.meta.url))
const packageAliases = [
  { find: /^@modelbay\/core\/([\w-]+)$/, replacement: `${packagesRoot}core/src/$1.ts` },
  { find: /^@modelbay\/([\w-]+)$/, replacement: `${packagesRoot}$1/src/index.ts` },
  { find: /^modelbay$/, replacement: `${packagesRoot}modelbay/src/index.ts` },
]

/**
 * 仓库级工具链配置（Vite+）：lint（Oxlint）、fmt（Oxfmt）、test（Vitest）都在这里；
 * 各包自己的打包配置在 packages/<name>/vite.config.ts 的 pack 段。
 */
export default defineConfig({
  resolve: { alias: packageAliases },
  staged: {
    '*.{ts,tsx,mts,cts,js,mjs,cjs,json,jsonc,css,html,yml,yaml,md}': 'vp check --fix',
    '*.md': 'markdownlint --fix',
  },
  lint: {
    // 去掉 plein 那套里的 react 和 a11y，本仓库没有 UI
    plugins: ['typescript', 'unicorn', 'oxc'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    categories: { correctness: 'error' },
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'typescript/no-explicit-any': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'typescript/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
      'typescript/unbound-method': 'off',
      'typescript/no-base-to-string': 'off',
      'typescript/restrict-template-expressions': 'off',
      'unicorn/no-useless-spread': 'off',
    },
    ignorePatterns: ['**/dist/**', '**/coverage/**'],
    options: { typeAware: true },
  },
  fmt: {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    endOfLine: 'lf',
    singleQuote: true,
    jsxSingleQuote: false,
    semi: false,
    trailingComma: 'all',
    arrowParens: 'always',
    proseWrap: 'preserve',
    embeddedLanguageFormatting: 'off',
    sortPackageJson: false,
    overrides: [
      {
        files: ['**/*.css', '**/*.md', '**/*.yaml', '**/*.yml', '**/*.html'],
        options: { singleQuote: false },
      },
    ],
    ignorePatterns: ['pnpm-lock.yaml', '**/dist/**', '**/coverage/**'],
  },
  test: {
    projects: ['packages/*'],
    alias: packageAliases,
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/*.gen.ts',
        '**/index.ts',
        '**/testing.ts',
        '**/test/**',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 45,
        branches: 40,
        'packages/core/src/**': { lines: 90, statements: 90, functions: 85, branches: 75 },
        'packages/ark/src/**': { lines: 80 },
        'packages/bailian/src/**': { lines: 80 },
        'packages/minimax/src/**': { lines: 80 },
        'packages/doubao-speech/src/**': { lines: 80 },
        'packages/openai/src/**': { lines: 80 },
        'packages/mcp/src/**': { lines: 80 },
      },
    },
  },
})
