import { defineConfig } from 'vite-plus'
import { packageAliases } from './vite.package'

/**
 * 仓库级工具链配置（Vite+）：lint（Oxlint）、fmt（Oxfmt）、test（Vitest）都在这里；
 * 各包的打包与测试别名统一由 vite.package.ts 的 definePackageConfig() 生成。
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
        '**/bin/**',
        '**/testing.ts',
        '**/test/**',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportOnFailure: true,
      // 按包门槛（core 90%，其余 80%）由 scripts/check-coverage.mjs 检查，这里只设全局底线
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 45,
        branches: 40,
      },
    },
  },
})
