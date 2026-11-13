import { describe, expect, it } from 'vite-plus/test'
import { createAdapterContext } from '@modelbay/core'
import { runNative, protocolRequest, protocolResponse, fileBlob } from '../src/native'
import { streamTts, synthesizeSpeech } from '../src/speech'

function context(reply: unknown = { ok: true }) {
  const requests: { url: string; init?: RequestInit }[] = []
  const ctx = createAdapterContext({
    secrets: { DEEPSEEK_API_KEY: 'sk-test' },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init })
      return Response.json(reply)
    },
  })
  return { ctx, requests }
}

describe('DeepSeek standalone APIs', () => {
  it('routes named search/fetch and validates URLs before sending', async () => {
    const { ctx, requests } = context({ results: [] })
    await runNative('search', { query: 'a', count: 3, need_content: true }, ctx)
    expect(requests[0]?.url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      query: 'a',
      count: 3,
      need_content: true,
    })
    await runNative('fetch-url', { url: 'https://example.com' }, ctx)
    expect(requests[1]?.url).toBe('https://api.deepseek.com/v1/tools/fetch')
    await expect(
      runNative('fetch-url', { url: 'https://user:secret@example.com' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(runNative('search', { query: 'a', count: 51 }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(requests).toHaveLength(2)
  })
  it('uploads purpose before file and preserves expiration, OCR and ASR multipart', async () => {
    const { ctx, requests } = context({ id: 'file-api-test' })
    const input = { file: new Uint8Array([1, 2]), filename: 'doc.pdf', mime: 'application/pdf' }
    await runNative(
      'upload-file',
      {
        ...input,
        purpose: 'rich_layout_recognition',
        expires_after: { anchor: 'created_at', seconds: 3600 },
      },
      ctx,
    )
    const form = requests[0]?.init?.body as FormData
    expect([...form.keys()]).toEqual([
      'purpose',
      'expires_after[anchor]',
      'expires_after[seconds]',
      'file',
    ])
    expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(new Uint8Array([1, 2]).buffer)
    expect((requests[0]!.init!.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    await runNative('ocr', { ...input, purpose: 'text_recognition' }, ctx)
    await runNative('asr', { ...input, filename: 'audio.wav' }, ctx)
    expect(requests.map((r) => r.url)).toEqual([
      'https://api.deepseek.com/files',
      'https://api.deepseek.com/v1/tools/ocr',
      'https://api.deepseek.com/v1/tools/asr',
    ])
  })
  it('encodes file queries and rejects resource traversal', async () => {
    const { ctx, requests } = context()
    await runNative('list-files', { limit: 2, purpose: 'rich_layout_recognition' }, ctx)
    expect(requests[0]?.url).toContain('/files?limit=2&purpose=rich_layout_recognition')
    await runNative('retrieve-file', { file_id: 'file-api-a' }, ctx)
    await runNative('delete-file', { file_id: 'file-api-a' }, ctx)
    expect(requests[2]?.init?.method).toBe('DELETE')
    await expect(
      runNative('delete-file', { file_id: '../user/balance' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await runNative('user-balance', {}, ctx)
    await runNative('list-remote-models', {}, ctx)
    expect(requests.slice(-2).map((r) => r.url)).toEqual([
      'https://api.deepseek.com/user/balance',
      'https://api.deepseek.com/models',
    ])
  })
  it('preserves native protocol payloads and never authenticates arbitrary URLs', async () => {
    const { ctx, requests } = context({ content: [], usage: { input_tokens: 1 } })
    const body = { model: 'deepseek-flash', messages: [], tools: [{ type: 'deepseek_web_search' }] }
    const result = await protocolRequest(ctx, 'messages', body)
    expect(result).toEqual({ content: [], usage: { input_tokens: 1 } })
    expect(requests[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect((requests[0]!.init!.headers as Record<string, string>)['anthropic-beta']).toBe(
      'files-api-2025-04-14',
    )
    await runNative('responses', { body: { input: 'test', safety_check: { level: 'high' } } }, ctx)
    await runNative('fim', { body: { prompt: 'def', suffix: 'end' } }, ctx)
    await runNative('chat-completions', { body }, ctx)
    await expect(
      runNative('raw-request', { path: 'https://evil.example', body: {} }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(protocolRequest(ctx, 'responses', { stream: true })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(runNative('unsupported', {}, ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(requests).toHaveLength(4)
  })
  it('routes prefix completion through beta and exposes native SSE without JSON parsing', async () => {
    const { ctx, requests } = context()
    await runNative(
      'chat-completions',
      { body: { messages: [{ role: 'assistant', content: 'prefix', prefix: true }] } },
      ctx,
    )
    expect(requests[0]?.url).toBe('https://api.deepseek.com/beta/chat/completions')
    await runNative('raw-request', { path: '/beta/chat/completions', body: { messages: [] } }, ctx)
    expect(requests[1]?.url).toBe('https://api.deepseek.com/beta/chat/completions')
    const streaming = createAdapterContext({
      secrets: { DEEPSEEK_API_KEY: 'test' },
      fetchImpl: async (_url, init) => {
        expect(JSON.parse(String(init?.body)).stream).toBe(true)
        return new Response('data: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    })
    const response = await protocolResponse(streaming, 'fim', { stream: true, prompt: 'code' })
    expect(await response.text()).toBe('data: [DONE]\n\n')
  })
  it('supports runtime-neutral file input and reports invalid input', async () => {
    const { ctx } = context()
    expect(await (await fileBlob(ctx, { base64: 'AQI=' })).arrayBuffer()).toEqual(
      new Uint8Array([1, 2]).buffer,
    )
    expect((await fileBlob(ctx, new Blob(['x']))).size).toBe(1)
    await expect(fileBlob(ctx, { base64: '@@' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(fileBlob(ctx, '/tmp/a')).rejects.toMatchObject({ code: 'invalid_input' })
    const assets = createAdapterContext({
      assets: { load: async () => ({ data: new Uint8Array([1]), mime: 'audio/wav' }) },
    })
    expect((await fileBlob(assets, { assetId: 'asset', kind: 'audio' })).type).toBe('audio/wav')
  })
})

describe('DeepSeek speech', () => {
  it('returns binary TTS output and detects empty/truncated audio', async () => {
    const sent: string[] = []
    const ctx = createAdapterContext({
      secrets: { DEEPSEEK_API_KEY: 'test' },
      fetchImpl: async (_url, init) => {
        sent.push(String(init?.body))
        return new Response(new Uint8Array([1, 2]))
      },
    })
    const out = (await runNative(
      'tts',
      { text: 'hi', format: 'pcm', voice_id: 'tide', filter_markdown: false },
      ctx,
    )) as { outputs: { mime: string; data: Uint8Array }[] }
    expect(out.outputs[0]?.mime).toBe('audio/pcm')
    expect(JSON.parse(sent[0]!)).toEqual({
      text: 'hi',
      format: 'pcm',
      voice_id: 'tide',
      filter_markdown: false,
    })
    await expect(synthesizeSpeech(ctx, { text: ' ' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const empty = createAdapterContext({
      secrets: { DEEPSEEK_API_KEY: 'test' },
      fetchImpl: async () => new Response(),
    })
    await expect(synthesizeSpeech(empty, { text: 'hello' })).rejects.toMatchObject({
      code: 'unknown',
    })
    const wav = new Uint8Array(12)
    wav.set(new TextEncoder().encode('RIFF'))
    new DataView(wav.buffer).setUint32(4, 100, true)
    const truncated = createAdapterContext({
      secrets: { DEEPSEEK_API_KEY: 'test' },
      fetchImpl: async () => new Response(wav),
    })
    await expect(synthesizeSpeech(truncated, { text: 'hello' })).rejects.toMatchObject({
      code: 'unknown',
    })
  })
  it('sends text frames and requires a successful finish frame', async () => {
    const { ctx } = context()
    const sent: string[] = []
    const frames: (string | Uint8Array)[] = [
      new Uint8Array([1, 2]),
      JSON.stringify({ event: 'finish', code: 'success' }),
    ]
    let closed = false
    const outputs: Uint8Array[] = []
    for await (const frame of streamTts(
      ctx,
      ['hello', ' world'],
      async (url, headers) => {
        expect(url).toBe('wss://api.deepseek.com/v1/tools/tts?format=pcm')
        expect(headers.Authorization).toBe('Bearer sk-test')
        return {
          sendText: (text) => {
            sent.push(text)
          },
          receive: async () => frames.shift()!,
          close: () => {
            closed = true
          },
        }
      },
      { format: 'pcm' },
    ))
      outputs.push(frame)
    expect(sent.map((s) => JSON.parse(s))).toEqual([
      { event: 'text', text: 'hello' },
      { event: 'text', text: ' world' },
      { event: 'finish_text' },
    ])
    expect(outputs).toEqual([new Uint8Array([1, 2])])
    expect(closed).toBe(true)
    const consume = async () => {
      for await (const _ of streamTts(ctx, ['hello'], async () => ({
        sendText() {},
        receive: async () => JSON.stringify({ event: 'finish', code: 'content_filter' }),
        close() {},
      }))) {
        /* consume */
      }
    }
    await expect(consume()).rejects.toMatchObject({ code: 'content_policy' })
  })
  it('closes WebSocket on abort and rejects disconnected sessions', async () => {
    const controller = new AbortController()
    const ctx = createAdapterContext({
      secrets: { DEEPSEEK_API_KEY: 'test' },
      signal: controller.signal,
    })
    let closed = 0
    const iterator = streamTts(ctx, ['hello'], async () => ({
      sendText() {},
      receive: async () => {
        controller.abort()
        return new Uint8Array([1])
      },
      close() {
        closed += 1
      },
    }))
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' })
    expect(closed).toBeGreaterThan(0)
    const { ctx: live } = context()
    const disconnected = streamTts(live, ['hello'], async () => ({
      sendText() {},
      receive: async () => {
        throw new Error('closed')
      },
      close() {},
    }))
    await expect(disconnected.next()).rejects.toMatchObject({
      code: 'unavailable',
      outcome: 'unknown',
    })
  })
})
