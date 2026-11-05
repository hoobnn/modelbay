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
  { find: /^modelbay$/, replacement: `${packagesRoot}modelbay/src/index.ts` },
]

/**
 * 每个包的 vite.config.ts 都用它：打包入口按约定自动识别，不需要逐包维护。
 *
 * 约定的入口：`src/index.ts`（根入口）、`src/node/index.ts` 或 `src/node.ts`（`./node` 子路径）、
 * `src/bin/*.ts`（命令行入口）。
 */
export function definePackageConfig(configUrl: string) {
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
      entry,
      outDir: 'dist',
      format: 'esm',
      dts: { tsconfig: 'tsconfig.build.json' },
      unbundle: true,
      clean: true,
    },
    test: { alias: packageAliases },
  })
}
