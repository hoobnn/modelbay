/**
 * 本地 stdio 冒烟：用真实子进程与 OS 管道验证工具和 Skills over MCP。
 * 子进程由 `vpx -s` 运行 scripts/stdio-smoke-child.ts（真实的 createServer + attachStdioTransport）；
 * 工具清单由本测试用真实生成器产出后经 JSON 注入，替代「在 Claude Code 里实跑」。
 * vpx 用项目自身的 Vite+ 解析器加载 TS，源码无需 .ts 后缀，也无需先 build。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { generateTools, listTools } from '../src/generate'
import { FramedReader, encodeMessage, type Framing } from '../src/framing'
import { createSkillCatalog } from '../src/skills'
import {
  MCP_TOOL_GROUPS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPTool,
} from '../src/types'
import { fakeAdapter, type McpKey } from './fixtures'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHILD = fileURLToPath(new URL('../scripts/stdio-smoke-child.ts', import.meta.url))
const VPX = fileURLToPath(new URL('../../../node_modules/.bin/vpx', import.meta.url))

function toolsFor(platform: McpKey): MCPTool[] {
  const { adapter } = fakeAdapter()
  return listTools(generateTools(platform, { adapter }), MCP_TOOL_GROUPS.all)
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('stdio 冒烟等待响应超时')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

interface SmokeResult {
  responses: Map<number | string | null, JsonRpcResponse>
  stderr: string
}

async function runSmoke(framing: Framing, requests: JsonRpcRequest[]): Promise<SmokeResult> {
  const dir = mkdtempSync(join(tmpdir(), 'modelbay-mcp-smoke-'))
  const payloadFile = join(dir, 'payload.json')
  writeFileSync(
    payloadFile,
    JSON.stringify({
      platform: 'ark',
      serverInfo: { name: 'modelbay-mcp-ark', version: '0.1.0' },
      tools: toolsFor('ark'),
    }),
  )

  const child = spawn(VPX, ['-s', CHILD, payloadFile], {
    cwd: PACKAGE_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const responses = new Map<number | string | null, JsonRpcResponse>()
  const reader = new FramedReader()
  let stderr = ''
  let spawnError: unknown

  child.on('error', (error) => {
    spawnError = error
  })
  child.stderr.on('data', (chunk: Uint8Array) => {
    stderr += new TextDecoder().decode(chunk)
  })
  child.stdout.on('data', (chunk: Uint8Array) => {
    for (const { message } of reader.push(chunk)) {
      const response = message as JsonRpcResponse
      responses.set(response.id, response)
    }
  })

  for (const request of requests) {
    child.stdin.write(encodeMessage(request, framing))
  }

  try {
    await waitUntil(() => responses.size >= requests.length || Boolean(spawnError), 15000)
    if (spawnError) throw spawnError
  } finally {
    child.stdin.end()
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
  return { responses, stderr }
}

const REQUESTS: JsonRpcRequest[] = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'ping' },
]

function assertValid(smoke: SmokeResult): void {
  expect(smoke.stderr).not.toContain('Cannot find')
  const init = smoke.responses.get(1)
  expect(init?.result).toMatchObject({
    protocolVersion: '2024-11-05',
    serverInfo: { name: 'modelbay-mcp-ark' },
    capabilities: { extensions: { 'io.modelcontextprotocol/skills': {} } },
  })
  const list = smoke.responses.get(2)
  const tools = (list?.result as { tools?: MCPTool[] })?.tools ?? []
  expect(tools.length).toBeGreaterThanOrEqual(9)
  for (const tool of tools) {
    expect(typeof tool.name).toBe('string')
    expect(tool.inputSchema.type).toBe('object')
    expect(typeof tool.annotations.readOnlyHint).toBe('boolean')
    expect(typeof tool.annotations.destructiveHint).toBe('boolean')
  }
  expect(smoke.responses.get(3)?.result).toEqual({})
}

describe('stdio 冒烟（子进程 + 真实管道）', () => {
  it('换行分隔 JSON-RPC：initialize / tools/list / ping', async () => {
    assertValid(await runSmoke('line', REQUESTS))
  }, 30000)

  it('Content-Length 分隔 JSON-RPC：initialize / tools/list / ping', async () => {
    assertValid(await runSmoke('content-length', REQUESTS))
  }, 30000)

  it('现代客户端能发现技能并按清单读取和校验文件', async () => {
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    }
    const request = (id: number, method: string, params = {}): JsonRpcRequest => ({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: meta },
    })
    const root = 'skill://modelbay/ark/modelbay-video'
    const uri = `${root}/SKILL.md`
    const reference = `${root}/references/tools.md`
    const { responses } = await runSmoke('line', [
      request(1, 'server/discover'),
      request(2, 'skills/list'),
      request(3, 'skills/get', { uri }),
      request(4, 'resources/read', { uri }),
      request(5, 'resources/read', { uri: reference }),
      request(6, 'skills/get', { uri: reference }),
      request(7, 'resources/read', { uri: 'file:///README.md' }),
      request(8, 'skills/list', { cursor: 'unknown' }),
    ])

    expect(responses.get(1)?.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: expect.arrayContaining(['2026-07-28', '2025-11-25']),
      capabilities: { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'modelbay-mcp-ark' } },
    })
    expect(responses.get(2)?.result).toMatchObject({
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
    })
    const listed = responses.get(2)?.result as { skills: { uri: string }[] }
    const skill = listed.skills.find((entry) => entry.uri === uri)
    expect(skill).toMatchObject({ uri, frontmatter: { name: 'modelbay-video' } })
    expect(responses.get(3)?.result).toMatchObject({ skill })

    const files = [4, 5].flatMap((id) => {
      const response = responses.get(id)?.result as { contents: { uri: string; text: string }[] }
      return response.contents
    })
    expect(files[0]?.text).toContain('[工具清单](references/tools.md)')
    expect(files[1]?.text).toContain('`generate_video`')
    expect(files[1]?.text).not.toContain('`create_h3_context_ir_task`')
    expect(skill).toMatchObject({
      resources: files.map((file) => ({
        uri: file.uri,
        digest: `sha256:${createHash('sha256').update(file.text).digest('hex')}`,
        size: Buffer.byteLength(file.text),
      })),
    })
    for (const id of [6, 7, 8]) expect(responses.get(id)?.error?.code).toBe(-32602)
  }, 30000)
})

describe('Skills 使用同一个工具目录', () => {
  it('视频参考随工具组启用上传工具，单开上传组不会发布视频工作流', () => {
    const { adapter } = fakeAdapter()
    const set = generateTools('minimax', { adapter })
    const catalog = (groups: Parameters<typeof listTools>[1]) =>
      createSkillCatalog(set.platform, listTools(set, groups))
    const reference = 'skill://modelbay/minimax/modelbay-video/references/tools.md'

    const core = catalog(['core']).files.get(reference)?.text
    expect(core).toContain('`generate_video`')
    expect(core).not.toContain('`upload_file`')
    expect(catalog(['core', 'node']).files.get(reference)?.text).toContain('`upload_file`')
    expect(catalog(['node']).files.has(reference)).toBe(false)
  })
})
