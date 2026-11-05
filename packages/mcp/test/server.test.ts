import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vite-plus/test'
import { FramedReader, encodeMessage, parseContentLength } from '../src/framing'
import { createServer } from '../src/server'
import { attachStdioTransport } from '../src/stdio-transport'
import { createHandlers } from '../src/routing'
import { generateTools } from '../src/generate'
import { loadAdapter, resolveGroups, startServer } from '../src/launch'
import {
  MCP_TOOL_GROUPS,
  type CallToolResult,
  type MCPTool,
  type ServerHandlers,
} from '../src/types'
import { fakeAdapter, fakeContext, platformOf } from './fixtures'

const sampleTool: MCPTool = {
  name: 'chat',
  description: 'd',
  inputSchema: { type: 'object', properties: {} },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
}

function serverHandlers(overrides: Partial<ServerHandlers> = {}): ServerHandlers {
  return {
    serverInfo: { name: 'test-server', version: '1.0.0' },
    listTools: () => [sampleTool],
    callTool: async (name) => ({ content: [{ type: 'text', text: `called ${name}` }] }),
    ...overrides,
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil 超时')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

// ───────────────────────────── framing ─────────────────────────────

describe('FramedReader 换行帧', () => {
  it('单条 / 多条 / 分块 / 空行 / 非法 JSON', () => {
    const reader = new FramedReader()
    expect(reader.push('{"a":1}\n')).toEqual([{ message: { a: 1 }, framing: 'line' }])
    expect(reader.push('{"b":2}\n{"c":3}\n').map((item) => item.message)).toEqual([
      { b: 2 },
      { c: 3 },
    ])
    expect(reader.push('\n\n  \n{"d":4}\n').map((item) => item.message)).toEqual([{ d: 4 }])
    expect(reader.push('not-json\n{"e":5}\n').map((item) => item.message)).toEqual([{ e: 5 }])

    const split = new FramedReader()
    expect(split.push('{"x":')).toEqual([])
    expect(split.push('10}\n')).toEqual([{ message: { x: 10 }, framing: 'line' }])
  })

  it('UTF-8 多字节被 chunk 切断也能正确解析', () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(`${JSON.stringify({ text: '中文测试' })}\n`)
    const cut = bytes.findIndex((byte, index) => index > 5 && byte > 0x7f) + 1
    const reader = new FramedReader()
    expect(reader.push(bytes.slice(0, cut))).toEqual([])
    const result = reader.push(bytes.slice(cut))
    expect(result).toHaveLength(1)
    expect((result[0]!.message as { text: string }).text).toBe('中文测试')
  })

  it('Content-Length 帧与分块', () => {
    const reader = new FramedReader()
    const framed = encodeMessage({ hello: '世界' }, 'content-length')
    expect(reader.push(framed)).toEqual([{ message: { hello: '世界' }, framing: 'content-length' }])

    const split = new FramedReader()
    expect(split.push(framed.slice(0, 8))).toEqual([])
    expect(split.push(framed.slice(8))).toHaveLength(1)
  })

  it('非法 Content-Length 头被跳过，不影响后续消息', () => {
    const reader = new FramedReader()
    const bytes = new TextEncoder().encode('Content-Length: abc\r\n\r\n{"ok":true}\n')
    const decoded = reader.push(bytes)
    expect(decoded.map((item) => item.framing)).toEqual(['line'])
    expect(decoded.map((item) => item.message)).toContainEqual({ ok: true })
  })

  it('多个 Content-Length 消息连续解析', () => {
    const reader = new FramedReader()
    const a = encodeMessage({ n: 1 }, 'content-length')
    const b = encodeMessage({ n: 2 }, 'content-length')
    const joined = new Uint8Array(a.length + b.length)
    joined.set(a)
    joined.set(b, a.length)
    expect(reader.push(joined).map((item) => item.message)).toEqual([{ n: 1 }, { n: 2 }])
  })
})

describe('encodeMessage / parseContentLength', () => {
  it('line 帧以换行结尾且可 JSON 解析', () => {
    const encoded = encodeMessage({ id: 1 }, 'line')
    expect(encoded[encoded.length - 1]).toBe(0x0a)
    expect(JSON.parse(new TextDecoder().decode(encoded.slice(0, -1)))).toEqual({ id: 1 })
  })

  it('content-length 帧头长度按字节计且响应体一致', () => {
    const encoded = encodeMessage({ text: '中文' }, 'content-length')
    const text = new TextDecoder().decode(encoded)
    const headerEnd = text.indexOf('\r\n\r\n')
    const header = text.slice(0, headerEnd)
    const body = encoded.slice(new TextEncoder().encode(`${header}\r\n\r\n`).length)
    expect(header).toMatch(/Content-Length: \d+/i)
    expect(parseContentLength(new TextEncoder().encode(header))).toBe(body.length)
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ text: '中文' })
  })

  it('parseContentLength 解析多行头，非法返回 null', () => {
    expect(
      parseContentLength(
        new TextEncoder().encode('Content-Type: application/json\r\nContent-Length: 42'),
      ),
    ).toBe(42)
    expect(parseContentLength(new TextEncoder().encode('X: 1'))).toBeNull()
    expect(parseContentLength(new TextEncoder().encode('Content-Length: -1'))).toBeNull()
  })
})

// ───────────────────────────── server ─────────────────────────────

describe('createServer JSON-RPC', () => {
  const server = createServer(serverHandlers())

  const req = (method: string, params?: Record<string, unknown>) => ({
    jsonrpc: '2.0' as const,
    id: 1,
    method,
    ...(params ? { params } : {}),
  })

  it('initialize 返回协议版本、能力、serverInfo，并回显客户端版本', async () => {
    const response = await server.handle(req('initialize', { protocolVersion: '2025-06-18' }))
    expect(response?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test-server', version: '1.0.0' },
    })
    const fallback = await server.handle(req('initialize'))
    const fallbackResult = fallback?.result as { protocolVersion: string } | undefined
    expect(fallbackResult?.protocolVersion).toBe('2024-11-05')
  })

  it('ping / tools/list / tools/call', async () => {
    expect((await server.handle(req('ping')))?.result).toEqual({})
    expect((await server.handle(req('tools/list')))?.result).toEqual({ tools: [sampleTool] })
    const called = await server.handle(
      req('tools/call', { name: 'chat', arguments: { prompt: 'hi' } }),
    )
    const calledResult = called?.result as CallToolResult | undefined
    expect(calledResult?.content[0]?.text).toBe('called chat')
  })

  it('resources / prompts 列表返回空（超出基线的协议方法）', async () => {
    expect((await server.handle(req('resources/list')))?.result).toEqual({ resources: [] })
    expect((await server.handle(req('resources/templates/list')))?.result).toEqual({
      resourceTemplates: [],
    })
    expect((await server.handle(req('prompts/list')))?.result).toEqual({ prompts: [] })
  })

  it('通知（无 id）不回复', async () => {
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('tools/call 缺 name → -32602；工具抛错 → isError 结果', async () => {
    expect((await server.handle(req('tools/call', {})))?.error?.code).toBe(-32602)
    const throwing = createServer(
      serverHandlers({
        callTool: async () => {
          throw new Error('boom')
        },
      }),
    )
    const response = await throwing.handle(req('tools/call', { name: 'chat' }))
    const result = response?.result as CallToolResult | undefined
    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toBe('boom')
  })

  it('未知方法 → -32601；非法请求 → -32600', async () => {
    expect((await server.handle(req('nope')))?.error?.code).toBe(-32601)
    expect((await server.handle({ jsonrpc: '1.0', id: 1, method: 'ping' }))?.error?.code).toBe(
      -32600,
    )
    expect((await server.handle('garbage'))?.error?.code).toBe(-32600)
  })
})

// ───────────────────────────── transport ─────────────────────────────

describe('attachStdioTransport', () => {
  async function run(
    frames: Uint8Array[],
    handlers: ServerHandlers = serverHandlers(),
  ): Promise<{ messages: unknown[]; errors: unknown[]; detach: () => void }> {
    const input = new PassThrough()
    const output = new PassThrough()
    const messages: unknown[] = []
    const errors: unknown[] = []
    const reader = new FramedReader()
    output.on('data', (chunk: Uint8Array) => {
      for (const decoded of reader.push(chunk)) messages.push(decoded.message)
    })
    const detach = attachStdioTransport(createServer(handlers), input, output, {
      onError: (error) => errors.push(error),
    })
    for (const frame of frames) input.write(frame)
    await waitUntil(() => messages.length >= frames.length)
    return { messages, errors, detach }
  }

  it('line 帧进 / line 帧出', async () => {
    const { messages, detach } = await run([
      encodeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'line'),
      encodeMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'line'),
    ])
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, result: {} }),
        expect.objectContaining({ id: 2 }),
      ]),
    )
    detach()
  })

  it('Content-Length 帧进 / 同帧格式出', async () => {
    const { messages, detach } = await run([
      encodeMessage({ jsonrpc: '2.0', id: 7, method: 'ping' }, 'content-length'),
    ])
    expect(messages).toEqual([expect.objectContaining({ id: 7, result: {} })])
    detach()
  })

  it('handler 抛错走 onError，并回 -32603 兜底', async () => {
    const { messages, errors, detach } = await run(
      [encodeMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'line')],
      serverHandlers({
        listTools: () => {
          throw new Error('list failed')
        },
      }),
    )
    expect(errors).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: 3, error: { code: -32603 } })
    detach()
  })
})

// ───────────────────────────── routing ─────────────────────────────

describe('createHandlers tools/call 路由', () => {
  type Platform = 'ark' | 'minimax'

  function handlersFor(
    platform: Platform,
    adapter = fakeAdapter().adapter,
    secrets?: Record<string, string>,
  ) {
    const spec = platformOf(platform).secrets
    const defaultSecrets = Object.fromEntries((spec.required[0] ?? []).map((key) => [key, 'k']))
    const set = generateTools(platform, { adapter })
    return createHandlers({
      set,
      adapter,
      context: fakeContext(secrets ?? defaultSecrets),
      groups: MCP_TOOL_GROUPS.all,
      secrets: spec,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
  }

  it('listTools 返回启用组的工具', async () => {
    expect((await handlersFor('minimax').listTools()).length).toBeGreaterThanOrEqual(18)
    expect((await handlersFor('ark').listTools()).length).toBeGreaterThanOrEqual(9)
  })

  it('submit 工具路由到 adapter.submit', async () => {
    const { adapter, calls } = fakeAdapter()
    const handlers = handlersFor('ark', adapter)
    const result = await handlers.callTool('chat', { prompt: 'hi', model: 'ark:chat-pro' })
    expect((result as CallToolResult).isError).toBeUndefined()
    expect(calls.submit).toHaveLength(1)
    expect(calls.submit[0]).toMatchObject({
      capability: 'text.chat',
      model: 'chat-pro',
      input: { prompt: 'hi' },
    })
  })

  it('native 工具路由到 adapter.native', async () => {
    const { adapter, calls } = fakeAdapter()
    const handlers = handlersFor('minimax', adapter)
    await handlers.callTool('create_h3_context_ir_task', { foo: 1 })
    expect(calls.native).toEqual([{ op: 'context-ir', params: { foo: 1 } }])
  })

  it('adapter 没有 native() 时退化成带 native 字段的 submit', async () => {
    const { adapter, calls } = fakeAdapter({ native: undefined })
    const handlers = handlersFor('minimax', adapter)
    await handlers.callTool('create_h3_context_ir_task', { foo: 2 })
    expect(calls.submit).toHaveLength(1)
    expect((calls.submit[0] as { native: { op: string } }).native.op).toBe('context-ir')
  })

  it('local 工具不需要 key，本地回答', async () => {
    const handlers = handlersFor('minimax', fakeAdapter().adapter, {})
    const help = await handlers.callTool('get_tool_help', { tool: 'text_to_speech' })
    expect((help as CallToolResult).content[0]?.text).toBeTruthy()
    const models = await handlers.callTool('list_declared_models', {})
    expect((models as CallToolResult).structuredContent).toBeDefined()
    const voices = await handlers.callTool('list_voices', {})
    expect((voices as CallToolResult).content[0]?.text).toContain('Voice One')
    const jobs = await handlers.callTool('list_jobs', {})
    expect((jobs as CallToolResult).content[0]?.text).toContain('任务记录不落盘')
    const caps = await handlers.callTool('list_capabilities', {})
    expect((caps as CallToolResult).structuredContent).toBeDefined()
  })

  it('豆包语音本地处理器：usage-examples / capabilities / voices', async () => {
    const { adapter } = fakeAdapter()
    const set = generateTools('doubao-speech', { adapter })
    const handlers = createHandlers({
      set,
      adapter,
      context: fakeContext({}),
      groups: MCP_TOOL_GROUPS.all,
      secrets: platformOf('doubao-speech').secrets,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    const examples = (await handlers.callTool('get_speech_usage_examples', {})) as CallToolResult
    expect(examples.content[0]?.text).toContain('tools/list')
    const caps = (await handlers.callTool('list_speech_capabilities', {})) as CallToolResult
    expect(caps.structuredContent).toBeDefined()
    const voice = (await handlers.callTool('get_voice', { speaker_id: 'x' })) as CallToolResult
    expect(voice.content[0]?.text).toContain('Voice One')
  })

  it('未配置 key 返回清晰错误而不是崩溃', async () => {
    const handlers = handlersFor('ark', fakeAdapter().adapter, {})
    const result = (await handlers.callTool('chat', { prompt: 'x' })) as CallToolResult
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('未配置访问密钥')
  })

  it('适配器未就绪 / 未知工具都返回清晰错误', async () => {
    const set = generateTools('ark')
    const noAdapter = createHandlers({
      set,
      context: fakeContext({ ARK_API_KEY: 'k' }),
      groups: MCP_TOOL_GROUPS.all,
      secrets: platformOf('ark').secrets,
      serverInfo: { name: 'test', version: '1.0.0' },
    })
    expect(((await noAdapter.callTool('chat', {})) as CallToolResult).content[0]?.text).toContain(
      '适配器尚未就绪',
    )
    expect(((await noAdapter.callTool('nope', {})) as CallToolResult).content[0]?.text).toContain(
      '未知工具',
    )
  })
})

// ───────────────────────────── launch ─────────────────────────────

describe('launch', () => {
  it('resolveGroups 默认 core，解析并过滤非法组', () => {
    expect(resolveGroups({})).toEqual(['core'])
    expect(resolveGroups({ MODELBAY_MCP_GROUPS: 'core,realtime,node' })).toEqual([
      'core',
      'realtime',
      'node',
    ])
    expect(resolveGroups({ MODELBAY_MCP_GROUPS: 'bogus' })).toEqual(['core'])
    expect(resolveGroups({ MODELBAY_MCP_GROUPS: 'realtime, nope ,core' })).toEqual([
      'realtime',
      'core',
    ])
  })

  it('loadAdapter 在平台包未就绪时安全回退（不抛）', async () => {
    const result = await loadAdapter(platformOf('ark'))
    expect(result === undefined || typeof result === 'object').toBe(true)
  })

  it('startServer 注入流后可完成一次 tools/list 往返', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const messages: unknown[] = []
    const reader = new FramedReader()
    output.on('data', (chunk: Uint8Array) => {
      for (const decoded of reader.push(chunk)) messages.push(decoded.message)
    })
    const started = await startServer('ark', { env: {}, input, output })
    expect(started.set.all.length).toBeGreaterThan(0)
    input.write(encodeMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'line'))
    await waitUntil(() => messages.length >= 1)
    const response = messages[0] as { result?: { tools?: unknown[] } }
    expect(response.result?.tools?.length).toBeGreaterThanOrEqual(9)
    started.detach()
  })
})
