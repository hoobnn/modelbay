/**
 * 把 JSON-RPC server 接到 stdio：读 stdin 的帧 → 交给 server.handle → 按相同帧格式写回 stdout。
 * 纯模块（不依赖 core）；日志通过 options.onError 交给宿主写 stderr，绝不污染 stdout。
 */
import type { Readable, Writable } from 'node:stream'
import { FramedReader, encodeMessage } from './framing'
import type { JsonRpcResponse } from './types'

export interface StdioServerLike {
  handle(request: unknown): Promise<JsonRpcResponse | null>
}

export interface StdioTransportOptions {
  onError?: (error: unknown) => void
}

function idOf(message: unknown): number | string | null {
  if (message && typeof message === 'object' && 'id' in message) {
    const id = (message as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

async function dispatch(
  server: StdioServerLike,
  message: unknown,
  framing: 'line' | 'content-length',
  output: Writable,
  options: StdioTransportOptions,
): Promise<void> {
  try {
    const response = await server.handle(message)
    if (response !== null) output.write(encodeMessage(response, framing))
  } catch (error) {
    options.onError?.(error)
    const fallback: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: idOf(message),
      error: { code: -32603, message: 'Internal error' },
    }
    output.write(encodeMessage(fallback, framing))
  }
}

/** 返回解绑函数，便于测试与优雅退出。 */
export function attachStdioTransport(
  server: StdioServerLike,
  input: Readable,
  output: Writable,
  options: StdioTransportOptions = {},
): () => void {
  const reader = new FramedReader()
  const onData = (chunk: Uint8Array | string): void => {
    for (const { message, framing } of reader.push(chunk)) {
      void dispatch(server, message, framing, output, options)
    }
  }
  input.on('data', onData)
  return () => {
    input.off?.('data', onData)
  }
}
