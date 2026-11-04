/**
 * 本地 stdio 冒烟：真实子进程 + OS 管道，发 initialize / tools/list / ping，断言合法响应。
 * 子进程由 `vpx -s` 运行 scripts/stdio-smoke-child.ts（真实的 createServer + attachStdioTransport）；
 * 工具清单由本测试用真实生成器产出后经 JSON 注入，替代「在 Claude Code 里实跑」。
 * vpx 用项目自身的 Vite+ 解析器加载 TS，源码无需 .ts 后缀，也无需先 build。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { generateTools, listTools } from '../src/generate'
import { FramedReader, encodeMessage, type Framing } from '../src/framing'
import { PLATFORMS } from '../src/platform'
import {
  MCP_TOOL_GROUPS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPTool,
  type PlatformKey,
} from '../src/types'
import { fakeAdapter } from './fixtures'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHILD = fileURLToPath(new URL('../scripts/stdio-smoke-child.ts', import.meta.url))
const VPX = fileURLToPath(new URL('../../../node_modules/.bin/vpx', import.meta.url))

function toolsFor(platform: PlatformKey): MCPTool[] {
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
      serverInfo: { name: PLATFORMS.ark.command, version: '0.1.0' },
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
    serverInfo: { name: 'modelbay-ark-mcp' },
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
})
