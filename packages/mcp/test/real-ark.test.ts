/**
 * 方舟 MCP 工具 → 真实适配器（注入 fetch，不联网）：
 * 断言需要平台换算的参数确实落进上游请求体（thinking、size、fast、watermark 等）。
 */
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  body: Record<string, unknown>
}

function handlersWith(reply: (url: string) => Response) {
  const platform = platformOf('ark')
  const adapter = platform.createAdapters()[0]!
  const captured: Captured[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    captured.push({ url: String(url), body })
    return reply(String(url))
  }) as typeof fetch
  const handlers = createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, { ARK_API_KEY: 'k' }),
      fetchImpl,
      assets: createMcpAssetSource({ fetchImpl }),
    }),
    groups: MCP_TOOL_GROUPS.all,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    serverInfo: { name: 'test', version: '0.0.0' },
  })
  return { handlers, captured }
}

const chatSse = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const responsesJson = () =>
  Response.json({
    id: 'resp_1',
    status: 'completed',
    error: null,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'ok',
            annotations: [{ type: 'url_citation', title: 't', url: 'https://example.com' }],
          },
        ],
      },
    ],
    usage: { input_tokens: 3, output_tokens: 1 },
  })

const embeddingJson = () =>
  Response.json({
    id: 'emb-1',
    model: 'doubao-embedding-vision-251215',
    data: { embedding: [0.1], object: 'embedding' },
    usage: { prompt_tokens: 4, total_tokens: 4 },
  })

const imageJson = () =>
  Response.json({ data: [{ b64_json: 'AAAA' }], usage: { generated_images: 1 } })

describe('MCP 方舟工具经真实适配器', () => {
  it('chat：thinking 布尔值换成 thinking.type，parameters 进请求体', async () => {
    const { handlers, captured } = handlersWith(chatSse)
    for (const [thinking, type] of [
      [true, 'enabled'],
      [false, 'disabled'],
    ] as const) {
      await handlers.callTool('chat', {
        model: 'ark:doubao-seed-2-1-lite-260915',
        prompt: 'hi',
        thinking,
        parameters: { top_p: 0.5 },
      })
      expect(captured.at(-1)!.body.thinking).toEqual({ type })
      expect(captured.at(-1)!.body.top_p).toBe(0.5)
    }
  })

  it('chat：白名单外的 parameters 报错而不是静默忽略', async () => {
    const { handlers } = handlersWith(chatSse)
    await expect(
      handlers.callTool('chat', {
        model: 'ark:doubao-seed-2-1-lite-260915',
        prompt: 'hi',
        parameters: { not_a_field: true },
      }),
    ).rejects.toThrow(/not_a_field/)
  })

  it('chat：web_search 与 previous_response_id 走 /responses，返回 response_id 和引用', async () => {
    const { handlers, captured } = handlersWith(responsesJson)
    const out = await handlers.callTool('chat', {
      model: 'ark:doubao-seed-2-1-pro-260915',
      prompt: '今天有什么热点',
      web_search: { sources: ['toutiao'], limit: 3 },
      previous_response_id: 'resp_0',
      max_tool_calls: 2,
      thinking: false,
      max_tokens: 128,
    })
    expect(captured[0]!.url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(captured[0]!.body).toMatchObject({
      model: 'doubao-seed-2-1-pro-260915',
      tools: [{ type: 'web_search', sources: ['toutiao'], limit: 3 }],
      previous_response_id: 'resp_0',
      max_tool_calls: 2,
      thinking: { type: 'disabled' },
      max_output_tokens: 128,
    })
    expect(JSON.stringify(captured[0]!.body.input)).toContain('今天有什么热点')
    const text = JSON.stringify(out)
    expect(text).toContain('resp_1')
    expect(text).toContain('https://example.com')
  })

  it('chat：web_search=true 等价于空对象，放在 parameters 里也生效', async () => {
    const { handlers, captured } = handlersWith(responsesJson)
    await handlers.callTool('chat', {
      model: 'ark:doubao-seed-2-1-pro-260915',
      prompt: 'hi',
      web_search: true,
    })
    expect(captured[0]!.body.tools).toEqual([{ type: 'web_search' }])
    await handlers.callTool('chat', {
      model: 'ark:doubao-seed-2-1-lite-260915',
      prompt: 'hi',
      parameters: { previous_response_id: 'r9' },
    })
    expect(captured[1]!.url).toMatch(/\/responses$/)
    expect(captured[1]!.body.previous_response_id).toBe('r9')
  })

  it('chat：声明外的模型、越界取值在联网前报错', async () => {
    const { handlers, captured } = handlersWith(responsesJson)
    await expect(
      handlers.callTool('chat', {
        model: 'ark:ep-20260101-abc',
        prompt: 'hi',
        web_search: {},
      }),
    ).rejects.toThrow(/web_search/)
    await expect(
      handlers.callTool('chat', {
        model: 'ark:doubao-seed-2-1-pro-260915',
        prompt: 'hi',
        web_search: { limit: 99 },
      }),
    ).rejects.toThrow(/参数无效/)
    expect(captured).toHaveLength(0)
  })

  it('embed：texts、images、videos 与声明字段进 /embeddings/multimodal', async () => {
    const { handlers, captured } = handlersWith(embeddingJson)
    const out = await handlers.callTool('embed', {
      model: 'ark:doubao-embedding-vision',
      texts: ['猫'],
      images: ['https://example.com/cat.png'],
      videos: ['https://example.com/cat.mp4'],
      dimensions: 1024,
      parameters: { instructions: 'Target_modality: text and image and video.' },
    })
    expect(captured[0]!.url).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal')
    expect(captured[0]!.body).toEqual({
      model: 'doubao-embedding-vision-251215',
      input: [
        { type: 'text', text: '猫' },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
        { type: 'video_url', video_url: { url: 'https://example.com/cat.mp4' } },
      ],
      dimensions: 1024,
      instructions: 'Target_modality: text and image and video.',
    })
    expect(JSON.stringify(out)).toContain('emb-1')
  })

  it('embed：contents 原样放行；没传输入或声明外的字段报错', async () => {
    const { handlers, captured } = handlersWith(embeddingJson)
    const video = { type: 'video_url', video_url: { url: 'https://example.com/v.mp4', fps: 2 } }
    await handlers.callTool('embed', {
      model: 'ark:doubao-embedding-vision',
      contents: [video],
    })
    expect(captured[0]!.body.input).toEqual([video])
    await expect(
      handlers.callTool('embed', { model: 'ark:doubao-embedding-vision' }),
    ).rejects.toThrow(/texts/)
    await expect(
      handlers.callTool('embed', {
        model: 'ark:doubao-embedding-vision',
        texts: ['a'],
        parameters: { not_a_field: 1 },
      }),
    ).rejects.toThrow(/not_a_field/)
    expect(captured).toHaveLength(1)
  })

  it('generate_image：size 档位、output_format、watermark、fast 都进请求体', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'ark:doubao-seedream-5-0-pro-260628',
      prompt: '猫',
      size: '1K',
      output_format: 'png',
      watermark: true,
      fast: true,
    })
    expect(captured[0]!.body).toMatchObject({
      size: expect.stringMatching(/^\d+x\d+$/),
      output_format: 'png',
      watermark: true,
      optimize_prompt_options: { mode: 'fast' },
    })
  })

  it.each([{ background: 'transparent' }, { parameters: { background: 'transparent' } }])(
    'generate_image：Seedream 5.5 的透明通道参数进入请求体 %j',
    async (options) => {
      const { handlers, captured } = handlersWith(imageJson)
      await handlers.callTool('generate_image', {
        model: 'ark:doubao-seedream-5-5-261028',
        prompt: '透明图标',
        ...options,
      })
      expect(captured[0]!.body).toMatchObject({
        model: 'doubao-seedream-5-5-261028',
        background: 'transparent',
      })
    },
  )

  it('generate_image：仅用于 cutout 的图层配置明确报错', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await expect(
      handlers.callTool('generate_image', {
        model: 'ark:doubao-seedream-5-5-261028',
        prompt: '图标',
        layer_decomposition_options: { max_images: 100 },
      }),
    ).rejects.toThrow(/layer_decomposition_options/)
    expect(captured).toHaveLength(0)
  })

  it('generate_image：宽x高像素原样作为 size', async () => {
    const { handlers, captured } = handlersWith(imageJson)
    await handlers.callTool('generate_image', {
      model: 'ark:doubao-seedream-5-0-pro-260628',
      prompt: '猫',
      size: '1536x1024',
    })
    expect(captured[0]!.body.size).toBe('1536x1024')
  })

  it('generate_video：watermark、draft、return_last_frame、service_tier 与 audio 进请求体', async () => {
    const { handlers, captured } = handlersWith(() => Response.json({ id: 'cgt-1' }))
    await handlers.callTool('generate_video', {
      model: 'ark:doubao-seedance-2-5-260628',
      prompt: '日出',
      resolution: '480p',
      audio: false,
      watermark: true,
      draft: true,
      return_last_frame: true,
      parameters: { service_tier: 'default' },
    })
    expect(captured[0]!.body).toMatchObject({
      generate_audio: false,
      watermark: true,
      draft: true,
      return_last_frame: true,
      service_tier: 'default',
    })
  })
})
