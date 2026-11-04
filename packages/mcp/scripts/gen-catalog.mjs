// 从 docs/inventory/mcp-*.json 生成 src/catalog/<platform>.ts。
// 这些清单是 M4 的最小基线（G2 能力不缩水）：方舟 9、MiniMax 18、百炼 19、豆包语音 24，共 70 个工具。
// 清单来自 hoobnn-mcps / plein 的盘点，核对日期 2026-11-04。
// 生成物是纯数据（无逻辑、无 import），可直接被 vitest、vpx 和 vp pack 加载。
// annotations 不写入生成物：基线条目有缺 destructiveHint 的情况，运行时由能力元数据重新派生。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const INVENTORY = fileURLToPath(new URL('../../../docs/inventory/', import.meta.url))
const OUT = fileURLToPath(new URL('../src/catalog/', import.meta.url))

// 平台 key -> 盘点文件名。goals.md 的迁移顺序：方舟 → MiniMax → 百炼 → 豆包语音。
const SOURCES = {
  ark: 'mcp-volcengine-ark.json',
  minimax: 'mcp-minimax.json',
  bailian: 'mcp-ali-bailian.json',
  'doubao-speech': 'mcp-doubao-speech.json',
}

mkdirSync(OUT, { recursive: true })

for (const [platform, file] of Object.entries(SOURCES)) {
  const raw = JSON.parse(readFileSync(`${INVENTORY}${file}`, 'utf8'))
  const tools = raw.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }))
  const body = [
    `// 来源：docs/inventory/${file}（M4 工具清单最小基线）`,
    '// 核对日期：2026-11-04（对照 hoobnn-mcps / plein 盘点）',
    '// 由 scripts/gen-catalog.mjs 生成，请勿手工编辑。',
    '// 仅保留 name / description / inputSchema / outputSchema；annotations 由生成器按能力元数据重新派生。',
    '// 基线里各工具的模型参数默认值在此仅作「平台特有字段」保留；运行时的 model 字段由声明派生后覆盖。',
    `export default ${JSON.stringify(tools, null, 2)}`,
    '',
  ].join('\n')
  writeFileSync(`${OUT}${platform}.ts`, body)
  console.error(`catalog/${platform}.ts: ${tools.length} tools (from ${file})`)
}

// 写一份机器可读的清单，供测试/文档对照使用
const manifest = Object.fromEntries(
  Object.entries(SOURCES).map(([platform, file]) => [
    platform,
    { file, count: JSON.parse(readFileSync(`${INVENTORY}${file}`, 'utf8')).length },
  ]),
)
writeFileSync(`${OUT}manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.error(`generated from ${ROOT} (manifest at ${HERE})`)
