#!/usr/bin/env node
/** `modelbay-mcp <platform>`：启动某个平台的 MCP stdio 服务。 */
import { mcpPlatforms, startServer } from '../launch'

const key = process.argv[2]
if (!key) {
  const keys = mcpPlatforms().map((platform) => platform.key)
  process.stderr.write(`用法：modelbay-mcp <platform>\n可选平台：${keys.join('、')}\n`)
  process.exitCode = 2
} else {
  await startServer(key)
}
