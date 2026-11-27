/**
 * stdio 冒烟子进程入口，由 `vpx -s scripts/stdio-smoke-child.ts <payload>` 启动。
 * vpx 用项目自带的 Vite+ 解析器加载 TS（支持无后缀相对导入 / tsconfig paths），
 * 因此能直接复用「真实的」 createServer + attachStdioTransport，在真实 OS 管道上
 * 验证 stdio JSON-RPC、工具和按需读取的技能文件。
 */
import { readFileSync } from 'node:fs'
import { createServer } from '../src/server'
import { createSkillCatalog } from '../src/skills'
import { attachStdioTransport } from '../src/stdio-transport'
import type { CallToolResult, MCPTool, ServerInfo } from '../src/types'

interface Payload {
  platform: string
  serverInfo?: ServerInfo
  tools?: MCPTool[]
}

const payloadFile = process.argv[2] ?? ''
const payload = JSON.parse(readFileSync(payloadFile, 'utf8')) as Payload
const tools = payload.tools ?? []
const serverInfo = payload.serverInfo ?? { name: 'modelbay-mcp-smoke', version: '0.1.0' }

const server = createServer({
  serverInfo,
  skills: createSkillCatalog(payload.platform, tools),
  listTools: () => tools,
  callTool: async (name: string): Promise<CallToolResult> => ({
    content: [{ type: 'text', text: `smoke server: ${name} 未连接真实适配器` }],
    isError: true,
  }),
})

attachStdioTransport(server, process.stdin, process.stdout, {
  onError: (error) => process.stderr.write(`smoke error: ${String(error)}\n`),
})
