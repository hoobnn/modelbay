import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const packagesRoot = fileURLToPath(new URL('./packages/', import.meta.url))

/**
 * 测试阶段把包名直接解析到源码，不依赖 dist。顺序要紧：`/node` 子路径先匹配。
 * 根配置和每个包的配置共用这一份（vitest 的 projects 模式不继承根配置的 alias）。
 */
export const packageAliases = [
  { find: /^@modelbay\/([\w-]+)\/node$/, replacement: `${packagesRoot}$1/src/node/index.ts` },
  { find: /^@modelbay\/([\w-]+)$/, replacement: `${packagesRoot}$1/src/index.ts` },
  { find: /^modelbay\/node$/, replacement: `${packagesRoot}modelbay/src/node.ts` },
  {
    find: /^modelbay\/([\w-]+)\/node$/,
    replacement: `${packagesRoot}modelbay/src/platform/$1-node.ts`,
  },
  { find: /^modelbay\/([\w-]+)$/, replacement: `${packagesRoot}modelbay/src/platform/$1.ts` },
  { find: /^modelbay$/, replacement: `${packagesRoot}modelbay/src/index.ts` },
]

/**
 * 每个包的 vite.config.ts 都用它：打包入口按约定自动识别，不需要逐包维护。
 *
 * 约定的入口：`src/index.ts`（根入口）、`src/node/index.ts` 或 `src/node.ts`（`./node` 子路径）、
 * `src/bin/*.ts`（命令行入口）。
 */
export interface PackageConfigOptions {
  /**
   * 把 `@modelbay/*` 内部包打进产物（只给对外发布的 `modelbay` 用）。内部包不发布，
   * 产物里也不能再出现对它们的导入。
   */
  bundleWorkspace?: boolean
  /** 额外的打包入口：输出名（不含扩展名）→ 源文件，如 `{ 'ark/node': 'src/platform/ark-node.ts' }` */
  entries?: Record<string, string>
}

export function definePackageConfig(configUrl: string, options: PackageConfigOptions = {}) {
  const dir = fileURLToPath(new URL('.', configUrl))
  const entry = ['src/index.ts']
  for (const candidate of ['src/node/index.ts', 'src/node.ts']) {
    if (existsSync(`${dir}${candidate}`)) entry.push(candidate)
  }
  if (existsSync(`${dir}src/bin`)) {
    for (const name of readdirSync(`${dir}src/bin`).sort()) {
      if (name.endsWith('.ts')) entry.push(`src/bin/${name}`)
    }
  }
  return defineConfig({
    pack: {
      // 打包模式下入口用「输出名 → 源文件」，产物路径与 exports 子路径一一对应
      entry: options.entries
        ? {
            ...Object.fromEntries(entry.map((file) => [file.replace(/^src\/|\.ts$/g, ''), file])),
            ...options.entries,
          }
        : entry,
      outDir: 'dist',
      format: 'esm',
      dts: { tsconfig: 'tsconfig.build.json' },
      unbundle: !options.bundleWorkspace,
      clean: true,
      ...(options.bundleWorkspace
        ? {
            deps: {
              alwaysBundle: [/^@modelbay\//],
              dts: { alwaysBundle: [/^@modelbay\//] },
            },
          }
        : {}),
    },
    test: { alias: packageAliases },
  })
}
