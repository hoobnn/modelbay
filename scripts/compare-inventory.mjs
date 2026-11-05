#!/usr/bin/env node
// M2 逐项比对：把 declarations/**/*.json 与 plein-models.json 逐字段比对，
// 并把每一处差异及原因、以及抽取决策写进 docs/declaration-diff.md。
// 可单独运行，也被 export-declarations.mjs 在写完全部产物后调用。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const INVENTORY = join(root, 'docs/inventory/plein-models.json')
const DECL_DIR = join(root, 'declarations')
const META_PATH = join(DECL_DIR, '_meta.json')
const DIFF_PATH = join(root, 'docs/declaration-diff.md')
const COMPARE_FIELDS = [
  'id',
  'title',
  'capabilities',
  'limits',
  'voices',
  'features',
  'description',
  'agentOnly',
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}
function esc(value) {
  if (value === undefined) return '（无）'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, ' ')
}
// URL 包成行内代码，避免 markdownlint 的 MD034/no-bare-urls
function code(value) {
  return `\`${value}\``
}
// 表格里过长的值截短，避免把 zod 内部结构整段塞进报告
function briefVal(value, field) {
  if (field === 'options') return '（zod 内部结构，完整值见 plein-models.json）'
  const s =
    value === undefined ? '（无）' : typeof value === 'string' ? value : JSON.stringify(value)
  const safe = s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return safe.length > 160 ? `${safe.slice(0, 160)}…（截断）` : safe
}
function walkJson(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walkJson(path))
    else if (name.endsWith('.json') && !name.startsWith('_')) out.push(path)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
function fieldDiff(a, b, field) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa === sb) return null
  if (field === 'features' && Array.isArray(a) && Array.isArray(b)) {
    if (
      JSON.stringify(
        [...a].sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0)),
      ) ===
      JSON.stringify(
        [...b].sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0)),
      )
    )
      return { kind: 'order' }
  }
  return { kind: 'value' }
}

function buildDiff() {
  const providers = readJson(INVENTORY)
  const meta = existsSync(META_PATH) ? readJson(META_PATH) : null
  const declFiles = walkJson(DECL_DIR)
  const decls = declFiles.map((f) => ({
    path: relative(root, f),
    platform: relative(DECL_DIR, f).split(/[\\/]/)[0],
    ...readJson(f),
  }))

  // 基准：非 mock 的原始模型，按 id 建索引
  const baseline = new Map()
  let mockCount = 0
  let staticCount = 0
  let baselineOptions = 0
  let baselineDeprecated = 0
  for (const provider of providers) {
    for (const model of provider.models) {
      if (provider.id === 'plein/mock') {
        mockCount += 1
        continue
      }
      staticCount += 1
      if (model.options) baselineOptions += 1
      if (model.deprecated) baselineDeprecated += 1
      if (!baseline.has(model.id)) baseline.set(model.id, [])
      baseline.get(model.id).push({ providerId: provider.id, model })
    }
  }

  // 逐声明逐字段比对
  const differences = []
  let exactFields = 0
  let optionsSchemaCount = 0
  for (const decl of decls) {
    if (decl.optionsSchema) optionsSchemaCount += 1
    const sources = baseline.get(decl.id) ?? []
    const primary = sources.find((s) => s.providerId === 'volc/ark') ?? sources[0]
    let hasDiff = false
    for (const source of sources) {
      for (const field of COMPARE_FIELDS) {
        const d = fieldDiff(decl[field], source.model[field], field)
        if (!d) continue
        hasDiff = true
        const isPrimary = source === primary
        differences.push({
          platform: decl.platform,
          id: decl.id,
          field,
          baseline: esc(source.model[field]),
          actual: esc(decl[field]),
          providerId: source.providerId,
          reason: isPrimary
            ? '与主来源不一致（需排查）'
            : d.kind === 'order'
              ? '方舟两渠道合并：features 集合相同、顺序写法不同，取按量侧顺序'
              : '方舟两渠道合并：同一 id 在两个渠道字段不同，声明取按量侧（volc/ark）为主来源',
        })
      }
    }
    if (!hasDiff) exactFields += 1
  }

  // 有 options 但转不出 optionsSchema 的声明数量
  const optionsOmitted = decls.filter((d) => {
    const sources = baseline.get(d.id) ?? []
    return sources.some((s) => s.model.options) && !d.optionsSchema
  }).length

  // 结构性字段转换（deprecated / options / 0003 新增）
  const transformRows = []
  for (const decl of decls) {
    const sources = baseline.get(decl.id) ?? []
    if (sources.some((s) => s.model.deprecated)) {
      transformRows.push({
        id: decl.id,
        field: 'deprecated',
        handling: `不写入声明；映射为 lifecycle.status = '${decl.lifecycle.status}'`,
        reason: '0003 用生命周期枚举表达状态，ModelDeclaration 已 Omit deprecated',
      })
    }
    if (sources.some((s) => s.model.options)) {
      transformRows.push({
        id: decl.id,
        field: 'options',
        handling: decl.optionsSchema
          ? '转成 optionsSchema（简单 JSON Schema）'
          : '无法转换，省略 optionsSchema',
        reason: 'options 是 zod 内部结构，声明是纯数据，不保留 def/innerType',
      })
    }
  }

  const lines = []
  const h = (s) => lines.push(s)
  h('# 声明抽取逐项比对报告')
  h('')
  h(
    '> 本报告由 `node scripts/compare-inventory.mjs` 生成，`export-declarations.mjs` 末尾会自动调用。',
  )
  h(
    '> 基准：`docs/inventory/plein-models.json`；产物：`declarations/**/*.json` 与 `packages/*/src/models/*.ts`。',
  )
  h(
    '> 来源与核对日期：2026-11-05 逐个打开官方原文核对过；只有真正读到正文的页面才写当天的 `checkedAt`，读不到正文的保持 2026-11-04（清单见第三节）。',
  )
  h('')

  // 一
  h('## 一、结论摘要')
  h('')
  h('| 项 | 数量 |')
  h('| --- | --- |')
  h(`| 基准 provider | ${providers.length} |`)
  h(`| 基准模型（含 mock） | ${providers.reduce((n, p) => n + p.models.length, 0)} |`)
  h(`| mock（跳过） | ${mockCount} |`)
  h(`| 静态模型（待抽取） | ${staticCount} |`)
  h(`| 生成声明文件 | ${decls.length} |`)
  h(`| 数量差异 | ${decls.length - staticCount}（方舟按量/套餐同 id 合并，见第七节） |`)
  h(`| 逐字段完全一致的声明 | ${exactFields} |`)
  h(`| 内容/顺序差异条目 | ${differences.length}（见第六节，全部逐条说明） |`)
  h('')
  h('平台分布：')
  h('')
  h('| 平台包 | 声明数 | 渠道 |')
  h('| --- | --- | --- |')
  const dist = {}
  for (const d of decls) dist[d.platform] = (dist[d.platform] ?? 0) + 1
  const channelHint = {
    ark: 'ark、ark-plan',
    bailian: 'bailian',
    minimax: 'minimax',
    'doubao-speech': 'doubao-speech',
    openai: 'openai',
  }
  for (const [platform, count] of Object.entries(dist).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    h(`| ${platform} | ${count} | ${channelHint[platform] ?? '—'} |`)
  }
  h('')

  // 二
  h('## 二、平台映射与跳过说明')
  h('')
  h('| 原 provider | 平台包 | 渠道 channel | canonicalId 厂商前缀 |')
  h('| --- | --- | --- | --- |')
  if (meta) {
    for (const m of meta.platformMap) {
      h(`| ${m.providerId} | ${m.platform} | ${m.channel} | ${m.vendor} |`)
    }
  } else {
    h('| （元数据缺失，请先运行 export-declarations.mjs） | — | — | — |')
  }
  h('')
  h('`plein/mock` 不是真实平台（仅开发测试用），整组跳过，不生成声明：')
  h('')
  if (meta) {
    h(
      `- 跳过 ${meta.skippedMock.length} 个：${meta.skippedMock.map((i) => `\`${i}\``).join('、')}。`,
    )
  } else {
    h(`- 跳过 ${mockCount} 个 mock 模型。`)
  }
  h('')
  h(
    "百炼里模型 id 以 `MiniMax/` 开头的转售型号，会额外加一条 `{ channel: 'minimax', id: <去掉前缀> }` 渠道；本次静态清单中不含此类 id，规则未触发。",
  )
  h('')

  // 三
  h('## 三、来源与核对日期')
  h('')
  h(
    '- 每个声明的 `source` 与 `lifecycle.source` 都是 `{ url, checkedAt }`；`checkedAt` 是实际读到该页官方原文的日期。',
  )
  h(
    '- 2026-11-05 逐个打开了声明里的 `source.url` 核对状态、默认值与主要上限：真正读到正文的页面 `checkedAt` 写成 2026-11-05；正文由前端渲染、读不到内容的页面保持 2026-11-04，并在下面的表里列出。',
  )
  h(
    '- `source.url` 用各平台官方模型列表/文档页；`lifecycle.source.url` 对有特殊状态的模型优先用 `docs/inventory.md` 第三节列出的官方公告链接。',
  )
  h('')
  h('### 2026-11-05 逐页核对结果')
  h('')
  h('| 官方页面 | 读到正文 | 用到的声明 |')
  h('| --- | --- | --- |')
  if (meta) {
    const links = meta.officialLinks ?? {}
    h(`| ${code(meta.platformUrl.ark)} | 是 | 方舟按量渠道的全部模型 |`)
    h(`| ${code(links.arkAgentPlan)} | 是 | 方舟套餐渠道的模型（套餐概览） |`)
    h(
      `| ${code(meta.platformUrl.bailian)} | 是 | 百炼文本模型与 qwen-image-3.0-pro、wan2.7-image-pro |`,
    )
    h(
      `| ${code(links.bailianImage)} | 是 | 百炼 qwen-image-3.0、qwen-image-3.0-pro、wanx2.1-imageedit |`,
    )
    h(`| ${code(links.bailianVideo)} | 是 | 百炼 wan3.0-video、wan3.0-video-prime |`)
    h(`| ${code(links.bailianTts)} | 是 | 百炼配音系列 |`)
    h(`| ${code(meta.platformUrl.minimax)} | 是 | MiniMax 全部模型（含已下线的历史模型） |`)
    h(
      `| ${code(links.minimaxVideo)} | 是 | MiniMax-H3-Highspeed、MiniMax-H3-Lite、MiniMax-H3-Max |`,
    )
    h(`| ${code(links.minimaxMusic)} | 是 | music-3.0 的生命周期来源 |`)
    h(`| ${code(meta.platformUrl.openai)} | 是 | OpenAI 全部模型 |`)
    h(`| ${code(meta.platformUrl['doubao-speech'])} | 是 | 豆包语音模型列表（seed-audio-1.0） |`)
    h(`| ${code(links.doubaoSpeechTts)} | 是 | seed-tts-2.0、seed-icl-2.0 |`)
    h(`| ${code(links.doubaoSpeechAsr)} | 是 | bigmodel（流式语音识别） |`)
    h(
      `| ${code(links.arkDeprecation)} | 否（正文由前端渲染） | doubao-seedream-5-0-260128 的下线公告 |`,
    )
  }
  h('')
  if (meta?.unverified) {
    h(`读不到正文的页面保持 \`checkedAt = ${meta.unverified.checkedAt}\`，涉及的声明：`)
    h('')
    for (const id of meta.unverified.declarations) h(`- \`${id}\``)
    h('')
  }
  h('逐页核对中发现的出入（按官方原文改了声明）：')
  h('')
  h(
    '- 方舟套餐渠道的模型 ID 用点号写法（`doubao-seed-2.1-pro`、`glm-5.3`、`kimi-k3.1-pro`），只出现在「套餐概览」页，原来挂的「模型列表」页里没有；这些声明的 `source` 改指套餐概览页。',
  )
  h(
    '- 百炼的图像编辑与视频生成模型（`qwen-image-3.0`、`wanx2.1-imageedit`、`wan3.0-video`、`wan3.0-video-prime`）不在「模型大全」页，改指图像生成页 / 视频生成页。',
  )
  h(
    '- MiniMax 的模型清单在「模型列表」页（`/docs/faq/models`），原来的 `/docs/api-reference` 会跳到「Prompt 缓存」页；H3 的 Highspeed / Lite 变体只在视频生成接口页出现。',
  )
  h(
    '- 豆包语音的 `seed-tts-2.0`、`seed-icl-2.0`、`bigmodel`、`seed-audio-1.0` 各自改指对应的接口页；`seed-icl-1.0` 暂时找不到能读到正文的页面，保持原样。',
  )
  h('')
  h('| 平台 | 默认官方链接（source.url） |')
  h('| --- | --- |')
  if (meta) {
    for (const [platform, url] of Object.entries(meta.platformUrl))
      h(`| ${platform} | ${code(url)} |`)
  }
  h('')
  h(
    '`docs/inventory.md` 第三节列出的 3 个官方来源链接，以及 Seedream 下线公告（`lifecycle.source` 特殊状态用）：',
  )
  h('')
  if (meta) {
    h(`- MiniMax 音乐生成接口：${code(meta.officialLinks.minimaxMusic)}（music-3.0）`)
    h(`- 火山方舟下线公告：${code(meta.officialLinks.arkDeprecation)}（Seedream 5.0 Lite）`)
    h(`- 百炼语音合成模型：${code(meta.officialLinks.bailianTts)}（Qwen-Audio-TTS 系列）`)
    h(
      `- 火山方舟模型列表：${code(meta.officialLinks.arkDeprecation.replace('model-deprecation-notice', 'model-list'))}（同平台默认链接）`,
    )
  }
  h('')

  // 四
  h('## 四、生命周期状态映射')
  h('')
  h('`deprecated: true` 逐条对照官方原文映射成 0003 生命周期枚举，不一律 `retired`。规则：')
  h('')
  h('| 模型 / 条件 | 原标记 | 映射状态 | 附加字段 | 官方来源 |')
  h('| --- | --- | --- | --- | --- |')
  h(
    `| MiniMax \`music-3.0\` | deprecated | closed-to-new-accounts | since: 2026-08-20 | ${code(MINIMAX_MUSIC_URL_TEXT(meta))} |`,
  )
  h(
    `| Seedream 5.0 Lite 两个 ID | deprecated | sunsetting | sunsetOn: 2026-11-24 | ${code(ARK_DEPRECATION_URL_TEXT(meta))} |`,
  )
  h(
    `| 百炼 \`qwen-audio-3.0-tts-flash\`（若存在） | deprecated | superseded | by: qwen-audio-3.1-tts-flash | ${code(BAILIAN_TTS_URL_TEXT(meta))} |`,
  )
  h('| 其余 deprecated 且查不到官方原文 | deprecated | active（不伪造） | 列入待核对清单 | 无 |')
  h('| 所有其他模型 | — | active | — | 平台默认链接 |')
  h('')
  if (meta) {
    h('已按规则落地：')
    h('')
    h('| canonicalId | 原标记 | 新状态 | 依据 |')
    h('| --- | --- | --- | --- |')
    for (const r of meta.ruleApplied)
      h(`| ${r.canonicalId} | ${r.from} | ${r.to} | ${esc(r.note)} |`)
    h('')
    h(`### 待核对清单（${meta.pendingReview.length} 个）`)
    h('')
    h(
      '这些模型在 plein 里带 `deprecated: true`，但本次找不到对应的官方下线/状态公告原文，**不伪造状态**，一律保持 `active`，仅在此列出：',
    )
    h('')
    h('| provider | 模型 id | 原始 deprecated | 原始说明 | 缺失项 | 处理 |')
    h('| --- | --- | --- | --- | --- | --- |')
    for (const r of meta.pendingReview) {
      h(
        `| ${r.providerId} | ${r.id} | true | ${esc(r.description)} | ${r.missingSource} | ${r.handling} |`,
      )
    }
    h('')
    h('### 未触发 / 待补')
    h('')
    for (const n of meta.notTriggered) h(`- ${n.item}：${esc(n.reason)}`)
    h('')
  } else {
    h('（元数据缺失，生命周期明细请先运行 `node scripts/export-declarations.mjs`。）')
    h('')
  }

  // 五
  h('## 五、别名处理')
  h('')
  h(
    '`aliases` 含 `official`（同模型的多个官方 ID）与 `short`（简称）两类，均以数组字面量写入，并保证全局不冲突。',
  )
  h('')
  if (meta) {
    h(
      `从 MCP 工具清单识别到的简称词：${meta.aliases.shortWords.map((w) => `\`${w}\``).join('、')}。`,
    )
    h('')
    h('采用的 `short` 别名（从模型 id 末段识别、全局唯一）：')
    h('')
    h('| canonicalId | short |')
    h('| --- | --- |')
    if (meta.aliases.adopted.length === 0) h('| （无） | — |')
    for (const a of meta.aliases.adopted)
      h(`| ${a.canonicalId} | ${a.short.map((s) => `\`${s}\``).join('、')} |`)
    h('')
    h('`official` 别名：')
    h('')
    h('| canonicalId | official | 依据 |')
    h('| --- | --- | --- |')
    if (meta.aliases.official.length === 0) h('| （无） | — | — |')
    for (const a of meta.aliases.official)
      h(`| ${a.canonicalId} | \`${a.alias}\` | ${esc(a.note)} |`)
    h('')
    h('未采用的简称及原因：')
    h('')
    h('| 简称 | 涉及型号 | 原因 |')
    h('| --- | --- | --- |')
    for (const o of meta.aliases.omitted) {
      h(
        `| \`${o.word}\` | ${o.owners.length ? o.owners.map((x) => `\`${x}\``).join('、') : '（无唯一映射）'} | ${esc(o.reason)} |`,
      )
    }
    h('')
    h(
      '说明：MCP 清单里的 `pro` / `flash` / `wan` 等是**工具级参数别名**，跨工具同名但指向不同模型（例如方舟 `chat` 的 `pro` 指 Seed 2.1 pro、`generate_image` 的 `pro` 指 Seedream 5.0 Pro），不能安全地作为模型级全局别名；为保证「别名不冲突」，只采用能从模型 id 唯一识别、且全局只被一个声明占用的型号后缀简称。别名不等于任何模型的 id 或 canonicalId。',
    )
    h('')
  } else {
    h('（元数据缺失，别名明細请先运行 `node scripts/export-declarations.mjs`。）')
    h('')
  }

  // 六
  h('## 六、逐项字段比对')
  h('')
  h('### 6.1 比对范围')
  h('')
  h(`比对字段：${COMPARE_FIELDS.map((f) => `\`${f}\``).join('、')}。`)
  h(
    '基准取 `plein-models.json` 中同 id 的原始模型；方舟同 id 在 `volc/ark-plan` 与 `volc/ark` 各有一条，声明取按量侧（`volc/ark`）为主来源。',
  )
  h('')
  h(`- 逐字段完全一致的声明：${exactFields} / ${decls.length}。`)
  h(
    `- 基准中含 \`options\` 的模型：${baselineOptions}；生成 \`optionsSchema\` 的声明：${optionsSchemaCount}；因转不出而省略：${optionsOmitted}；其余差额 ${baselineOptions - optionsSchemaCount - optionsOmitted} 来自方舟两渠道同 id 合并（两条原始记录合成一条声明）。`,
  )
  h(`- 基准中含 \`deprecated\` 的模型：${baselineDeprecated}。`)
  h('')
  h('### 6.2 差异明细（逐条）')
  h('')
  if (differences.length === 0) {
    h('各声明与基准的上述字段全部逐项一致，无内容差异。')
  } else {
    h('| 平台 | 模型 id | 字段 | 基准值 | 声明值 | 来源 provider | 原因 |')
    h('| --- | --- | --- | --- | --- | --- | --- |')
    for (const d of differences) {
      h(
        `| ${d.platform} | ${d.id} | \`${d.field}\` | ${d.baseline} | ${d.actual} | ${d.providerId} | ${esc(d.reason)} |`,
      )
    }
  }
  h('')
  h('### 6.3 字段转换与新增（结构性差异）')
  h('')
  h('- `deprecated`：不写入声明，改由 `lifecycle.status` 表达（见第四节）。')
  h(
    "- `options`：zod 内部结构转成 `optionsSchema`（`{ type: 'object', properties: {...} }`），声明不保留 `options` / `def` / `innerType`；转不出的省略 `optionsSchema`。",
  )
  h(
    '- 新增字段：`canonicalId`、`channels`、`aliases`、`lifecycle`、`source`（均为 0003 要求）；`capabilities` 沿用 plein 原有 9 种，未硬加 0003 新增的归一化能力。',
  )
  h(
    '- `description` / `features` / `limits` / `voices` / `agentOnly` / `title` / `id` 等原有字段原样保留。',
  )
  h('')
  h('转换明细：')
  h('')
  h('| 模型 id | 字段 | 处理 | 原因 |')
  h('| --- | --- | --- | --- |')
  for (const r of transformRows)
    h(`| ${r.id} | \`${r.field}\` | ${esc(r.handling)} | ${esc(r.reason)} |`)
  h('')

  // 七
  h('## 七、方舟两渠道合并')
  h('')
  h(
    '`volc/ark-plan`（套餐）与 `volc/ark`（按量）归到同一个 `ark` 包。两个 provider 里 id 相同的模型合并成**一条声明、两条 channel**（`ark` 与 `ark-plan`），canonicalId 相同。',
  )
  h('')
  if (meta) {
    h(
      `共同 id 共 ${meta.merged.length} 个，因此静态模型 ${meta.inventory.staticModels} 个合并成声明 ${decls.length} 个（少 ${meta.inventory.staticModels - decls.length} 个）：`,
    )
    h('')
    h('| 模型 id | 来源 provider | 合并后 channels | 主来源 |')
    h('| --- | --- | --- | --- |')
    for (const m of meta.merged)
      h(`| ${m.id} | ${m.sources.join('、')} | ${m.channels.join('、')} | ${m.primary} |`)
    h('')
    // 套餐渠道的 ID 单独核对：官方「套餐概览」页的写法与按量渠道可能不同（点号 / 短横线）。
    const planChannels = decls
      .filter((d) => d.platform === 'ark')
      .map((d) => {
        const ark = (d.channels ?? []).find((c) => c.channel === 'ark')
        const plan = (d.channels ?? []).find((c) => c.channel === 'ark-plan')
        return ark && plan ? { id: d.id, ark: ark.id, plan: plan.id, source: plan.source } : null
      })
      .filter(Boolean)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (planChannels.length) {
      h('两条渠道的渠道内 ID 各自来自各自的官方页面，逐条列出：')
      h('')
      h('| 模型 id | ark（按量）ID | ark-plan（套餐）ID | 套餐 ID 的来源 |')
      h('| --- | --- | --- | --- |')
      for (const c of planChannels) {
        const source = c.source?.url
          ? `[${c.source.url}](${c.source.url})（核对 ${c.source.checkedAt}）`
          : '（与模型级来源相同）'
        h(`| ${c.id} | \`${c.ark}\` | \`${c.plan}\` | ${source} |`)
      }
      h('')
      h(
        '说明：套餐渠道的 ID 照官方「套餐概览」页原样写（点号 / 短横线与按量渠道不同就照抄），' +
          '不按按量渠道的 ID 推断；因此同一模型在两条渠道的渠道内 ID 可能不同，' +
          '渠道级 `source` 记录套餐 ID 核对的那一页。',
      )
      h('')
    }
    const mergedDiffs = meta.merged.filter((m) => m.fieldDiffs.length > 0)
    h(`其中 ${mergedDiffs.length} 个模型在两渠道间字段取值不同，逐条列出（声明统一取主来源值）：`)
    h('')
    h('| 模型 id | 字段 | 主来源(volc/ark)值 | 另一渠道值 |')
    h('| --- | --- | --- | --- |')
    for (const m of mergedDiffs) {
      for (const d of m.fieldDiffs) {
        h(
          `| ${m.id} | \`${d.field}\` | ${briefVal(d.primaryValue, d.field)} | ${briefVal(d.otherValue, d.field)}（${d.providerId}） |`,
        )
      }
    }
    h('')
    h(
      '说明：`agentOnly`、`features` 顺序、`description`、`options` 等差异属于套餐渠道（内置 Agent）特有或写法不同；合并后声明的模型级字段取按量侧，渠道差异体现在 `channels` 上。',
    )
    h('')
  }

  // 八
  h('## 八、声明自检')
  h('')
  h('由 `node scripts/check-declarations.mjs`（`pnpm check:declarations`）执行，覆盖：')
  h('')
  h('- TS 声明为纯数据、`export default { ... } satisfies ModelDeclaration`；')
  h('- 每个 JSON 声明能按 core 的 `declarationJsonSchema()` 思路生成合法 JSON Schema；')
  h(
    '- `source.url` / `source.checkedAt` / `lifecycle.source.url` / `lifecycle.source.checkedAt` 齐备且格式合法；',
  )
  h('- `lifecycle.status` 合法；非 `active` 不能带默认标记；')
  h('- 别名跨声明不冲突、不与模型 id / canonicalId 冲突；')
  h('- 声明不含 `deprecated` / `options`，`optionsSchema` 不含 zod 内部字段。')
  h('')

  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  return `${body.replace(/\n+$/, '')}\n`
}

function MINIMAX_MUSIC_URL_TEXT(meta) {
  return meta
    ? meta.officialLinks.minimaxMusic
    : 'https://platform.minimax.cn/docs/api-reference/music-generation'
}
function ARK_DEPRECATION_URL_TEXT(meta) {
  return meta
    ? meta.officialLinks.arkDeprecation
    : 'https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh'
}
function BAILIAN_TTS_URL_TEXT(meta) {
  return meta ? meta.officialLinks.bailianTts : 'https://help.aliyun.com/zh/model-studio/tts-model'
}

export function run(opts = {}) {
  const diff = buildDiff()
  writeFileSync(DIFF_PATH, diff, 'utf8')
  if (!opts.quiet) {
    const declCount = walkJson(DECL_DIR).length
    console.log(`逐项比对完成：${declCount} 个声明，报告写入 ${relative(root, DIFF_PATH)}`)
  }
}

if (isMain()) run()
