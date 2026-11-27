import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'
import type { MCPTool } from './types'

const skillRoot = new URL('../skills/', import.meta.url)
const frontmatterSchema = z.looseObject({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(1024),
  metadata: z
    .object({
      'modelbay-entry-tools': z.string().refine((value) => value.trim().length > 0),
      'modelbay-related-tools': z.string().optional(),
    })
    .catchall(z.string()),
})

interface SkillEntry {
  uri: string
  frontmatter: { name: string; description: string } & Record<string, unknown>
  resources: { uri: string; digest: string; size: number }[]
}

interface SkillFile {
  uri: string
  name: string
  mimeType: string
  text: string
}

export interface SkillCatalog {
  entries: ReadonlyMap<string, SkillEntry>
  files: ReadonlyMap<string, SkillFile>
}

function toolReference(tools: readonly MCPTool[]): string {
  const lines = tools.map(({ name, description, inputSchema }) => {
    const required = inputSchema.required ?? []
    const fields = required.length
      ? `（必填 ${required.map((key) => `\`${key}\``).join('、')}）`
      : ''
    const summary = description.split('\n', 1)[0]?.trim() ?? ''
    return `- \`${name}\`${fields} ${summary}`.trimEnd()
  })
  return `# 当前连接的工具\n\n${lines.join('\n')}\n`
}

/** 启动时固定清单与文件字节，后续读取和清单中的摘要始终对应。 */
export function createSkillCatalog(platform: string, tools: readonly MCPTool[]): SkillCatalog {
  const available = new Map(tools.map((tool) => [tool.name, tool]))
  const entries = new Map<string, SkillEntry>()
  const files = new Map<string, SkillFile>()
  const names = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const name of names) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, skillRoot), 'utf8')
    const header = /^---\r?\n([\s\S]+?)\r?\n---\r?\n/.exec(text)?.[1]
    const frontmatter = frontmatterSchema.parse(header ? parse(header) : undefined)
    if (frontmatter.name !== name) throw new Error(`Skill 名称与目录不一致：${name}`)

    const primary = frontmatter.metadata['modelbay-entry-tools'].trim().split(/\s+/)
    if (!primary.some((tool) => available.has(tool))) continue

    const related = frontmatter.metadata['modelbay-related-tools']?.trim().split(/\s+/) ?? []
    const visible = [...new Set([...primary, ...related])]
      .map((tool) => available.get(tool))
      .filter((tool) => tool !== undefined)
    const root = `skill://modelbay/${encodeURIComponent(platform)}/${name}`
    const uri = `${root}/SKILL.md`
    const skillFiles = [
      { uri, name: `${name}/SKILL.md`, mimeType: 'text/markdown', text },
      {
        uri: `${root}/references/tools.md`,
        name: `${name}/references/tools.md`,
        mimeType: 'text/markdown',
        text: toolReference(visible),
      },
    ]
    entries.set(uri, {
      uri,
      frontmatter,
      resources: skillFiles.map((file) => ({
        uri: file.uri,
        digest: `sha256:${createHash('sha256').update(file.text).digest('hex')}`,
        size: Buffer.byteLength(file.text),
      })),
    })
    for (const file of skillFiles) files.set(file.uri, file)
  }

  return { entries, files }
}
