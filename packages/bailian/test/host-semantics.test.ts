/**
 * 宿主语义下的百炼用例（请求体、前置校验、错误分类、轮询语义）。
 * 上下文按宿主的形状构造：settings 全带默认值、files.read 带媒体元数据。
 */
import { describe, expect, it } from 'vite-plus/test'
import type { AdapterRequest, CapabilityInput } from '@modelbay/core'
import { createBailianAdapter } from '../src/adapter'
import { all as bailianModels } from '../src/models/index'
import { fakeContext, sse, type FakeOptions, type Reply } from './helpers'

const adapter = createBailianAdapter(bailianModels)
const defaults = {
  region: 'cn-beijing',
  workspaceId: '',
  voice: 'Cherry',
  language: 'Auto',
  pollIntervalMs: 10000,
}
const setup = (replies: Reply[] = [], opts: FakeOptions = {}) =>
  fakeContext(replies, {
    secrets: { DASHSCOPE_API_KEY: 'sk-test' },
    settings: { ...defaults },
    files: { width: 1024, height: 1024 },
    ...opts,
  })
const read = (ctx: ReturnType<typeof setup>['ctx']) =>
  ctx.files!.read as unknown as { mock: unknown }
const submit = (ctx: ReturnType<typeof setup>['ctx'], req: AdapterRequest) =>
  adapter.submit(req, ctx)

const stream =
  'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n'
const imageResult = {
  output: {
    choices: [
      {
        message: {
          content: [{ image: 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/a.png' }],
        },
      },
    ],
  },
}
const policy = {
  data: {
    upload_host: 'https://dashscope.oss-cn-beijing.aliyuncs.com',
    upload_dir: 'tmp',
    oss_access_key_id: 'id',
    signature: 'sig',
    policy: 'policy',
    x_oss_object_acl: 'private',
    x_oss_forbid_overwrite: 'true',
  },
}
const reference = { assetId: 'ref', kind: 'image' as const }

describe('对话走共享流式层', () => {
  it('流式兼容 API，归一化回答和 usage，保护 model/messages', async () => {
    const { ctx, fetch, body } = setup([sse(stream)])
    const result = await submit(ctx, {
      capability: 'text.chat',
      model: 'qwen3.7-plus',
      input: {
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 30,
        extra: { model: 'evil', stream: false },
      },
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ type: 'text', text: '你好' }],
      usage: { inputTokens: 3, outputTokens: 2 },
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(body()).toMatchObject({ model: 'qwen3.7-plus', stream: true, max_tokens: 30 })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-test')
  })

  it('工具调用：工具随请求发送，调用作为 tool_calls 返回；文字边生成边回调', async () => {
    const call = {
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'create_node', arguments: '{"type":"plein/image"}' },
    }
    const frames = [
      { choices: [{ delta: { content: '好的，' } }] },
      { choices: [{ delta: { content: '我来建' } }] },
      { choices: [{ delta: { tool_calls: [call] }, finish_reason: 'tool_calls' }] },
    ]
    const { ctx, body } = setup([
      sse(`${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`),
    ])
    const deltas: string[] = []
    ctx.stream = (d) => deltas.push(d.text)
    const result = await submit(ctx, {
      capability: 'text.chat',
      model: 'qwen3.7-plus',
      input: {
        messages: [
          { role: 'user', content: '画一张图' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_0', name: 'get_canvas', arguments: {} }],
          },
          {
            role: 'tool',
            toolCallId: 'call_0',
            toolName: 'get_canvas',
            content: '{"elements":[]}',
          },
        ],
        tools: [
          {
            name: 'create_node',
            description: '新建节点',
            parameters: { type: 'object', properties: { type: { type: 'string' } } },
          },
        ],
      },
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [
        { type: 'text', text: '好的，我来建' },
        {
          type: 'tool_calls',
          calls: [{ id: 'call_1', name: 'create_node', arguments: { type: 'plein/image' } }],
        },
      ],
    })
    expect(deltas).toEqual(['好的，', '我来建'])
    const sent = body() as { tools: Array<{ function: { name: string } }>; messages: unknown[] }
    expect(sent.tools[0]!.function.name).toBe('create_node')
    expect(sent.messages).toMatchObject([
      { role: 'user' },
      { role: 'assistant', tool_calls: [{ id: 'call_0', function: { name: 'get_canvas' } }] },
      { role: 'tool', tool_call_id: 'call_0' },
    ])
  })

  it('结构化输出：要求 JSON、Schema 写进系统提示，结果按 Schema 校验', async () => {
    const answer = (content: string) =>
      sse(
        `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
    const schema = {
      type: 'object',
      properties: { shots: { type: 'integer' } },
      required: ['shots'],
    }
    const { ctx, body } = setup([answer('{"shots":3}'), answer('{"shots":"三"}')])
    const run = () =>
      submit(ctx, {
        capability: 'text.chat',
        model: 'qwen3.7-plus',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '拆分镜' },
                { type: 'image', image: { assetId: 'a', kind: 'image' } },
              ],
            },
          ],
          jsonSchema: schema,
        },
      })
    expect(await run()).toMatchObject({ outputs: [{ type: 'json', value: { shots: 3 } }] })
    const sent = body()
    expect(sent.response_format).toEqual({ type: 'json_object' })
    expect(sent.messages[0]).toMatchObject({ role: 'system' })
    expect(sent.messages[0].content).toContain('"shots"')
    expect(sent.messages[1].content).toEqual([
      { type: 'text', text: '拆分镜' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ])
    await expect(run()).rejects.toMatchObject({ code: 'unknown' })
  })

  it('缺少 DONE 时拒绝成功且不会重新提交', async () => {
    const { ctx, fetch } = setup([sse(stream.replace('data: [DONE]\n\n', ''))])
    await expect(
      submit(ctx, {
        capability: 'text.chat',
        model: 'qwen3.7-plus',
        input: { messages: [{ role: 'user', content: 'hi' }] },
      }),
    ).rejects.toMatchObject({ code: 'unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('remoteOnly：对话透传远端模型 ID，其他能力仍须是声明过的模型', async () => {
    const { ctx, fetch } = setup([
      sse(
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    ])
    await expect(
      submit(ctx, {
        capability: 'text.chat',
        model: 'qwen-brand-new',
        remoteOnly: true,
        input: { messages: [{ role: 'user', content: '嗨' }] },
      }),
    ).resolves.toMatchObject({ state: 'succeeded' })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/compatible-mode/v1/chat/completions')
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('qwen-brand-new')
    await expect(
      submit(ctx, {
        capability: 'image.generate',
        model: 'image-brand-new',
        remoteOnly: true,
        input: { prompt: 'x' },
      }),
    ).rejects.toThrow(/不支持/)
  })

  it('HTTP、SSE 与异步失败均脱敏密钥', async () => {
    const sensitive = 'sk-test'
    const { ctx } = setup([
      sse(`data: {"error":{"code":"InvalidApiKey","message":"invalid ${sensitive}"}}\n\n`),
      { output: { task_status: 'FAILED', code: 'InvalidApiKey', message: `invalid ${sensitive}` } },
      Response.json(
        { error: { code: 'InvalidApiKey', message: `invalid ${sensitive}` } },
        { status: 401 },
      ),
    ])
    await expect(
      submit(ctx, {
        capability: 'text.chat',
        model: 'qwen3.7-plus',
        input: { messages: [{ role: 'user', content: 'hi' }] },
      }),
    ).rejects.toMatchObject({ message: 'invalid [REDACTED]' })
    expect(await adapter.poll!('t', ctx)).toMatchObject({
      state: 'failed',
      error: { code: 'auth', message: 'invalid [REDACTED]' },
    })
    await expect(
      submit(ctx, {
        capability: 'audio.speech',
        model: 'qwen3-tts-flash',
        input: { text: 'hi' },
      }),
    ).rejects.toMatchObject({ message: 'invalid [REDACTED]' })
  })
})

describe('语音', () => {
  it('官方 HTTP 结果地址升级为 HTTPS，签名不变', async () => {
    const { ctx } = setup([
      {
        output: {
          audio: {
            data: '',
            url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav?Signature=fixture&Expires=123',
          },
        },
      },
    ])
    expect(
      await submit(ctx, {
        capability: 'audio.speech',
        model: 'qwen3-tts-flash',
        input: { text: '你好' },
      }),
    ).toMatchObject({
      state: 'succeeded',
      outputs: [
        {
          type: 'file',
          url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav?Signature=fixture&Expires=123',
        },
      ],
    })
  })

  it('语音 input、音色和业务空间端点符合 Qwen-TTS API', async () => {
    const { ctx, fetch, body } = setup(
      [
        {
          output: {
            audio: { url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav' },
          },
        },
      ],
      { settings: { ...defaults, workspaceId: 'work-123' } },
    )
    const result = await submit(ctx, {
      capability: 'audio.speech',
      model: 'qwen3-tts-flash',
      input: { text: '你好', voice: 'Cherry' },
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ kind: 'audio', mime: 'audio/wav' }],
    })
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://work-123.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    )
    expect(body().input).toMatchObject({ text: '你好', voice: 'Cherry', language_type: 'Auto' })
  })

  it('默认音色与语言取宿主设置', async () => {
    const { ctx, body } = setup(
      [{ output: { audio: { url: 'https://x.oss-cn-beijing.aliyuncs.com/a.wav' } } }],
      { settings: { ...defaults, voice: 'Ethan', language: 'Chinese' } },
    )
    await submit(ctx, {
      capability: 'audio.speech',
      model: 'qwen3-tts-flash',
      input: { text: '你好' },
    })
    expect(body().input).toMatchObject({ voice: 'Ethan', language_type: 'Chinese' })
  })

  it('下线 instruct 模型与不支持的语气 / 语速字段在发包前拒绝', async () => {
    const { ctx, fetch } = setup()
    for (const req of [
      { model: 'qwen3-tts-instruct-flash', input: { text: '你好' } },
      { model: 'qwen3-tts-flash', input: { text: '你好', instruction: '温柔' } },
      { model: 'qwen3-tts-flash', input: { text: '你好', speed: 1.5 } },
      { model: 'qwen3-tts-flash', input: { text: ' ' } },
      { model: 'qwen3-tts-flash', input: { text: '字'.repeat(601) } },
      ...['instruction', 'instructions', 'optimize_instructions'].map((field) => ({
        model: 'qwen3-tts-flash',
        input: { text: '你好', extra: { [field]: '温柔' } },
      })),
    ]) {
      await expect(
        submit(ctx, { capability: 'audio.speech', ...req } as AdapterRequest),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('业务层安全与欠费错误归一化', async () => {
    for (const [code, expected] of [
      ['DataInspectionFailed', 'content_policy'],
      ['Arrearage', 'quota'],
    ]) {
      const { ctx } = setup([{ code, message: 'failed' }])
      await expect(
        submit(ctx, {
          capability: 'audio.speech',
          model: 'qwen3-tts-flash',
          input: { text: 'hi' },
        }),
      ).rejects.toMatchObject({ code: expected })
    }
  })

  it('提交遇 503 / 429 不可重试，轮询遇 503 / 429 可重试', async () => {
    for (const status of [503, 429]) {
      const busy = () => Response.json({ code: 'Throttling', message: 'busy' }, { status })
      const { ctx } = setup([busy(), busy()])
      await expect(
        submit(ctx, {
          capability: 'audio.speech',
          model: 'qwen3-tts-flash',
          input: { text: 'hi' },
        }),
      ).rejects.toMatchObject({ retryable: false })
      await expect(adapter.poll!('t', ctx)).rejects.toMatchObject({ retryable: true })
    }
  })

  it.each([408, 500, 502, 503, 504])(
    'POST HTTP %i 的 HTML / JSON 网关响应保留 unknown',
    async (status) => {
      for (const response of [
        new Response('<html>gateway</html>', { status }),
        Response.json({ error: { message: 'gateway' } }, { status }),
      ]) {
        const { ctx, fetch } = setup([response])
        await expect(
          submit(ctx, {
            capability: 'audio.speech',
            model: 'qwen3-tts-flash',
            input: { text: 'local' },
          }),
        ).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
        expect(fetch).toHaveBeenCalledTimes(1)
      }
    },
  )
})

describe('图片尺寸与预检', () => {
  const generate = (ctx: ReturnType<typeof setup>['ctx'], model: string, input: object) =>
    submit(ctx, {
      capability: 'image.generate',
      model,
      input: { prompt: 'p', ...input } as CapabilityInput<'image.generate'>,
    })

  it('参考图编码并解析多图输出', async () => {
    const { ctx, body } = setup([
      {
        output: {
          choices: [
            {
              message: {
                content: [
                  { image: 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/a.png' },
                  { image: 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/b.png' },
                ],
              },
            },
          ],
        },
        usage: { output_image_count: 2 },
      },
    ])
    const result = await generate(ctx, 'qwen-image-3.0-pro', {
      width: 1024,
      height: 1024,
      count: 2,
      references: [reference],
    })
    expect(result).toMatchObject({ state: 'succeeded', usage: { images: 2 } })
    expect(body().input.messages[0].content[1]).toEqual({ image: 'data:image/png;base64,AQID' })
    expect(body().parameters).toMatchObject({ size: '1024*1024', n: 2 })
  })

  it('aspectRatio 映射官方 size，显式 size 优先且不透传未知字段', async () => {
    for (const model of ['qwen-image-3.0-pro', 'wan2.7-image-pro']) {
      for (const [extra, expected] of [
        [{ aspectRatio: '9:16', unknown: true }, '936*1664'],
        [{ aspectRatio: '16:9', size: '1024*1024' }, '1024*1024'],
        [{}, '1664*936'],
      ] as const) {
        const { ctx, body } = setup([imageResult])
        await generate(ctx, model, { extra })
        expect(body().parameters.size).toBe(expected)
        expect(body().parameters).not.toHaveProperty('aspectRatio')
        expect(body().parameters).not.toHaveProperty('unknown')
      }
    }
  })

  it('Qwen 的 2K 档位转为像素尺寸，智能比例默认不传 size', async () => {
    const { ctx, body } = setup([imageResult, imageResult])
    await generate(ctx, 'qwen-image-3.0-pro', {
      count: 6,
      resolution: '2K',
      extra: { aspectRatio: '16:9' },
    })
    expect(body().parameters).toMatchObject({ size: '2720*1536', n: 6 })
    await generate(ctx, 'qwen-image-3.0-pro', {
      extra: {
        aspectRatio: 'auto',
        prompt_extend: true,
        prompt_extend_mode: 'direct',
        enable_thinking: true,
      },
    })
    expect(body(1).parameters).not.toHaveProperty('size')
    expect(body(1).parameters).toMatchObject({ prompt_extend: true, enable_thinking: true })
  })

  it('Wan 文生图发送 4K 像素尺寸，智能画幅发送原生档位；组图可发送十二张', async () => {
    const { ctx, body } = setup([imageResult, imageResult, imageResult])
    await generate(ctx, 'wan2.7-image-pro', {
      resolution: '4K',
      extra: { aspectRatio: '16:9' },
    })
    const [width, height] = body().parameters.size.split('*').map(Number)
    expect(width * height).toBeGreaterThan(2048 ** 2)
    expect(width * height).toBeLessThanOrEqual(4096 ** 2)
    await generate(ctx, 'wan2.7-image-pro', { resolution: '4K', extra: { aspectRatio: 'auto' } })
    expect(body(1).parameters.size).toBe('4K')
    await generate(ctx, 'wan2.7-image-pro', {
      prompt: '组图',
      count: 12,
      resolution: '2K',
      references: [reference],
      extra: { enable_sequential: true, aspectRatio: '9:16' },
    })
    expect(body(2).parameters).toMatchObject({ n: 12, enable_sequential: true, size: '1536*2720' })
  })

  it.each([
    ['wan2.7-image-pro', { resolution: '4K', references: [reference] }],
    ['wan2.7-image-pro', { resolution: '4K', extra: { enable_sequential: true } }],
    ['wan2.7-image-pro', { count: 5 }],
    ['wan2.7-image-pro', { count: 13, extra: { enable_sequential: true } }],
    ['wan2.7-image-pro', { extra: { size: '4096*4096' }, references: [reference] }],
    ['wan2.7-image-pro', { extra: { size: '4K', enable_sequential: true } }],
    ['qwen-image-3.0-pro', { resolution: '4K' }],
    ['qwen-image-3.0-pro', { resolution: '2K', extra: { aspectRatio: 'auto' } }],
    ['qwen-image-3.0-pro', { count: 7 }],
    ['qwen-image-3.0-pro', { extra: { size: '4096*4096' } }],
    ['qwen-image-3.0-pro', { extra: { size: '100*100' } }],
    ['qwen-image-3.0-pro', { extra: { size: '1024*1' } }],
    ['qwen-image-3.0-pro', { extra: { size: 'bad' } }],
    ['qwen-image-3.0-pro', { extra: { prompt_extend_mode: 'agent' }, references: [reference] }],
    ['qwen-image-3.0-pro', { extra: { prompt_extend_mode: 'bogus' } }],
    ['qwen-image-3.0-pro', { width: 1024 }],
  ] as const)('%s 无效组合不读取素材、不联网：%j', async (model, input) => {
    const { ctx, fetch } = setup()
    await expect(generate(ctx, model, input)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
    expect(read(ctx).mock).toMatchObject({ calls: [] })
  })

  it('显式自定义尺寸优先于画幅和档位，兼容 x 与 *', async () => {
    const { ctx, body } = setup([imageResult])
    await generate(ctx, 'qwen-image-3.0', {
      resolution: '2K',
      extra: { aspectRatio: 'auto', size: '1536x1024' },
    })
    expect(body().parameters.size).toBe('1536*1024')
  })

  it('seed 超出声明范围时联网前拒绝，范围内照常提交', async () => {
    const bad = setup([])
    await expect(generate(bad.ctx, 'qwen-image-3.0-pro', { seed: -1 })).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'qwen-image-3.0-pro 的种子须为 0–2147483647 的整数，现在是 -1',
    })
    expect(bad.fetch).not.toHaveBeenCalled()
    const ok = setup([imageResult])
    await generate(ok.ctx, 'qwen-image-3.0-pro', { seed: 42 })
    expect(ok.body().parameters.seed).toBe(42)
  })

  it('预检与提交使用同一个 seed：顶层优先于专属参数', async () => {
    const { ctx, body } = setup([imageResult])
    await generate(ctx, 'qwen-image-3.0-pro', { seed: 7, extra: { seed: -1 } })
    expect(body().parameters.seed).toBe(7)
  })

  it('目录声明的数量、参考上限与文本长度上限', () => {
    const limits = (id: string) => bailianModels.find((m) => m.id === id)?.limits
    expect(limits('qwen-image-3.0-pro')).toMatchObject({
      count: { max: 6 },
      references: { max: 3 },
    })
    expect(limits('wan2.7-image-pro')).toMatchObject({ count: { max: 4 }, references: { max: 9 } })
    expect(limits('wanx2.1-imageedit')).toMatchObject({ count: { max: 1 }, promptMaxLength: 800 })
    expect(limits('qwen3-tts-flash')?.promptMaxLength).toBe(600)
    for (const id of ['wan3.0-video', 'wan3.0-video-prime'])
      expect(limits(id)).toMatchObject({ referenceMedia: { video: 5, audio: 5 } })
  })
})

describe('视频', () => {
  const generate = (ctx: ReturnType<typeof setup>['ctx'], input: object, model = 'wan3.0-video') =>
    submit(ctx, {
      capability: 'video.generate',
      model,
      input: { prompt: 'p', ...input } as CapabilityInput<'video.generate'>,
    })

  it('异步视频可跨上下文轮询、取消，未知状态不无限轮询', async () => {
    const { ctx, fetch } = setup([
      { output: { task_id: 'task/1', task_status: 'PENDING' } },
      { output: { task_status: 'RUNNING' } },
      {
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v.mp4',
        },
      },
      { output: { task_status: 'CANCELED' } },
      { output: { task_status: 'UNKNOWN' } },
    ])
    expect(await generate(ctx, { duration: 5 })).toMatchObject({
      state: 'pending',
      remoteId: 'task/1',
      pollAfterMs: 10000,
    })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('X-DashScope-Async')).toBe('enable')
    expect(await adapter.poll!('task/1', { ...ctx })).toMatchObject({ state: 'pending' })
    expect(await adapter.poll!('task/1', ctx)).toMatchObject({
      state: 'succeeded',
      outputs: [{ kind: 'video' }],
    })
    await adapter.cancel!('task/1', ctx)
    expect(fetch.mock.calls[3]?.[0]).toMatch(/tasks\/task%2F1\/cancel$/)
    await expect(adapter.poll!('missing', ctx)).rejects.toMatchObject({ code: 'unknown' })
  })

  it('轮询间隔取宿主设置', async () => {
    const { ctx } = setup([{ output: { task_status: 'RUNNING' } }], {
      settings: { ...defaults, pollIntervalMs: 3000 },
    })
    expect(await adapter.poll!('t', ctx)).toMatchObject({ pollAfterMs: 3000 })
  })

  it('FAILED 按远端错误码分类，CANCELED 不当成失败重试', async () => {
    const cases: Array<[Record<string, unknown>, string, boolean | undefined]> = [
      [{ code: 'DataInspectionFailed', message: 'blocked' }, 'content_policy', false],
      [{ code: 'Arrearage', message: 'no balance' }, 'quota', false],
      [{ code: 'Throttling', message: 'busy' }, 'rate_limit', false],
      [{ message: 'weird' }, 'unknown', false],
    ]
    for (const [output, code] of cases) {
      const { ctx } = setup([{ output: { task_status: 'FAILED', ...output } }])
      expect(await adapter.poll!('t', ctx)).toMatchObject({
        state: 'failed',
        error: { code },
      })
    }
    const noMessage = setup([{ output: { task_status: 'FAILED' } }])
    expect(await adapter.poll!('t', noMessage.ctx)).toMatchObject({
      state: 'failed',
      error: { message: '百炼任务状态：FAILED' },
    })
  })

  it('取消被拒绝时按远端错误码抛出', async () => {
    const { ctx } = setup([{ output: { code: 'InvalidApiKey', message: 'bad' } }])
    await expect(adapter.cancel!('t', ctx)).rejects.toMatchObject({ code: 'auth' })
  })

  it('首尾帧上传 OSS 后启用资源解析请求头', async () => {
    const { ctx, fetch, body } = setup([policy, {}, { output: { task_id: 't' } }])
    await generate(ctx, { firstFrame: { assetId: 'img', kind: 'image' } })
    expect(body(2).input.media[0]).toMatchObject({
      type: 'first_frame',
      url: expect.stringMatching(/^oss:\/\/tmp\//),
    })
    expect(
      new Headers(fetch.mock.calls[2]?.[1]?.headers).get('X-DashScope-OssResourceResolve'),
    ).toBe('enable')
  })

  it('自动时长只发送 duration=-1，不泄露界面参数名', async () => {
    const { ctx, body } = setup([{ output: { task_id: 't' } }])
    await generate(ctx, { duration: 5, extra: { adaptive_duration: true } })
    expect(body().parameters.duration).toBe(-1)
    expect(body().parameters).not.toHaveProperty('adaptive_duration')
  })

  it.each([
    { duration: 1 },
    { duration: 31 },
    { duration: 2.5 },
    { resolution: '4K' },
    { aspectRatio: '3:2' },
    { extra: { adaptive_duration: 'yes' } },
    { lastFrame: { assetId: 'l', kind: 'image' } },
    { firstFrame: { assetId: 'f', kind: 'image' }, references: [reference] },
    { prompt: ' ' },
    { references: Array.from({ length: 6 }, (_, i) => ({ assetId: `a${i}`, kind: 'audio' })) },
    { references: Array.from({ length: 6 }, (_, i) => ({ assetId: `v${i}`, kind: 'video' })) },
    { references: Array.from({ length: 11 }, (_, i) => ({ assetId: `i${i}`, kind: 'image' })) },
  ])('视频参数不合法时不联网：%j', async (input) => {
    const { ctx, fetch } = setup()
    await expect(generate(ctx, input)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { duration: 21, references: [{ assetId: 'v', kind: 'video' as const }] },
    {
      duration: 5,
      references: [
        { assetId: 'v1', kind: 'video' as const },
        { assetId: 'v2', kind: 'video' as const },
      ],
    },
  ])('在上传之前拒绝超出时长预算的参考任务：%j', async (input) => {
    const { ctx, fetch } = setup([], { mime: 'video/mp4', files: { duration: 10 } })
    await expect(generate(ctx, input)).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('时长'),
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('恰好三十秒的输入加输出可提交，素材只读一次，extra 不能覆盖通用参数', async () => {
    const { ctx, body } = setup([policy, {}, { output: { task_id: 't' } }], {
      mime: 'video/mp4',
      files: { duration: 10 },
    })
    await generate(ctx, {
      duration: 20,
      resolution: '720P',
      references: [{ assetId: 'v', kind: 'video' }],
      extra: { resolution: '4K', ratio: 'bad', duration: 100 },
    })
    expect(read(ctx).mock).toMatchObject({ calls: [[{ assetId: 'v' }]] })
    expect(body(2).parameters).toMatchObject({ resolution: '720P', ratio: '16:9', duration: 20 })
  })

  it('自适应时长不与参考视频时长相加', async () => {
    const { ctx } = setup([policy, {}, { output: { task_id: 't' } }], {
      mime: 'video/mp4',
      files: { duration: 14 },
    })
    await expect(
      generate(ctx, {
        duration: 20,
        references: [{ assetId: 'v', kind: 'video' }],
        extra: { adaptive_duration: true },
      }),
    ).resolves.toMatchObject({ state: 'pending' })
  })
})

describe('精修与局部重绘', () => {
  const model = 'wanx2.1-imageedit'
  const image = { assetId: 'source', kind: 'image' as const }
  const upload = () => [policy, new Response(null, { status: 200 })] as Reply[]

  it.each([
    {
      operation: 'upscale' as const,
      scale: 3,
      functionName: 'super_resolution',
      params: { n: 1, upscale_factor: 3 },
    },
    {
      operation: 'outpaint' as const,
      expansion: { top: 1, bottom: 2, left: 1.5, right: 1.25 },
      functionName: 'expand',
      params: { n: 1, top_scale: 1, bottom_scale: 2, left_scale: 1.5, right_scale: 1.25 },
    },
  ])('$operation 走图像编辑异步接口并保留任务 ID', async (input) => {
    const f = setup([...upload(), { output: { task_id: 'task1' } }])
    const result = await submit(f.ctx, {
      capability: 'image.process',
      model,
      input: {
        image,
        operation: input.operation,
        scale: input.scale,
        expansion: input.expansion,
        prompt: '保留原有的红色屋顶',
      },
    })
    expect(result).toMatchObject({ state: 'pending', remoteId: 'task1' })
    expect(f.fetch.mock.calls[2]?.[0]).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
    )
    const headers = new Headers(f.fetch.mock.calls[2]?.[1]?.headers)
    expect(headers.get('X-DashScope-Async')).toBe('enable')
    expect(headers.get('X-DashScope-OssResourceResolve')).toBe('enable')
    expect(f.body(2)).toMatchObject({
      model,
      input: {
        function: input.functionName,
        prompt: '保留原有的红色屋顶',
        base_image_url: expect.stringMatching(/^oss:\/\/tmp\//),
      },
      parameters: input.params,
    })
    // 原图只读一次，上传复用
    expect(read(f.ctx).mock).toMatchObject({ calls: [[image]] })
  })

  it.each([
    { operation: 'upscale' as const, prompt: undefined },
    { operation: 'upscale' as const, prompt: '' },
    { operation: 'outpaint' as const, prompt: undefined },
    { operation: 'outpaint' as const, prompt: '' },
  ])('用户未填写提示词时 HTTP 请求不补入默认文字 %j', async (input) => {
    const f = setup([...upload(), { output: { task_id: 'task1' } }])
    await submit(f.ctx, { capability: 'image.process', model, input: { image, ...input } })
    expect(f.body(2).input).toMatchObject({ prompt: '' })
  })

  it.each([
    { operation: 'upscale' as const, scale: NaN },
    { operation: 'upscale' as const, scale: 5 },
    { operation: 'outpaint' as const, expansion: { top: Infinity, bottom: 1, left: 1, right: 1 } },
    { operation: 'cutout' as const },
    { operation: 'upscale' as const, image: { assetId: 'audio', kind: 'audio' as const } },
  ])('参数无效时不上传也不提交 %j', async (input) => {
    const f = setup()
    await expect(
      submit(f.ctx, {
        capability: 'image.process',
        model,
        input: { image, ...input } as CapabilityInput<'image.process'>,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it.each([
    { mime: 'video/mp4' },
    { mime: 'image/gif' },
    { files: { width: 511, height: 1024 } },
    { files: { width: 1024, height: 4097 } },
    { files: { width: NaN, height: 1024 } },
  ])('图片格式和尺寸在上传前校验 %j', async (opts) => {
    const f = setup([], opts)
    await expect(
      submit(f.ctx, { capability: 'image.process', model, input: { image, operation: 'upscale' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('提交成功但 task_id 缺失时保持 unknown，已有上传不造成重新生成', async () => {
    const f = setup([...upload(), { output: {} }])
    await expect(
      submit(f.ctx, { capability: 'image.process', model, input: { image, operation: 'upscale' } }),
    ).rejects.toMatchObject({ code: 'unknown' })
    expect(f.fetch).toHaveBeenCalledTimes(3)
  })

  it('局部重绘请求多张时在上传素材前拒绝', async () => {
    const f = setup()
    const edit = createBailianAdapter(bailianModels, {
      edit: async () => {
        throw new Error('不应进入预处理')
      },
    })
    await expect(
      edit.submit(
        {
          capability: 'image.edit',
          model,
          input: {
            prompt: '把杯子换成红色',
            image,
            mask: { assetId: 'mask', kind: 'image' },
            count: 2,
          },
        },
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', message: '万相图像编辑一次仅支持生成 1 张' })
    expect(f.fetch).not.toHaveBeenCalled()
    expect(read(f.ctx).mock).toMatchObject({ calls: [] })
  })

  it('局部重绘：extra 透传到 parameters，n 与 seed 以顶层为准', async () => {
    const f = setup([{ output: { task_id: 'edit/1' } }])
    const edit = createBailianAdapter(bailianModels, {
      edit: async (_ctx, opts) => ({
        model: opts.model,
        input: { function: 'description_edit_with_mask', prompt: opts.prompt },
        parameters: { ...opts.extra, n: opts.count, seed: opts.seed },
      }),
    })
    await edit.submit(
      {
        capability: 'image.edit',
        model,
        input: {
          prompt: '把杯子换成红色',
          image,
          mask: { assetId: 'mask', kind: 'image' },
          seed: 3,
          extra: { n: 9, watermark: false },
        },
      },
      f.ctx,
    )
    expect(f.body().parameters).toEqual({ watermark: false, n: 1, seed: 3 })
  })
})

describe('域名与远端模型列表', () => {
  it.each([
    ['cn-beijing', '', 'https://dashscope.aliyuncs.com'],
    ['ap-southeast-1', '', 'https://dashscope-intl.aliyuncs.com'],
    ['us-east-1', '', 'https://dashscope-us.aliyuncs.com'],
    ['ap-southeast-1', 'ws-1', 'https://ws-1.ap-southeast-1.maas.aliyuncs.com'],
  ])('地域 %s 业务空间 %j 的域名', async (region, workspaceId, host) => {
    const { ctx, fetch } = setup([{ output: { task_status: 'RUNNING' } }], {
      settings: { ...defaults, region, workspaceId },
    })
    await adapter.poll!('t', ctx)
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${host}/api/v1/tasks/t`)
  })

  it('listModels：走 DashScope 兼容模式列表，归一化并声明 structured', async () => {
    const { ctx, fetch } = setup([
      { object: 'list', data: [{ id: 'qwen3.8-max' }, { object: 'model' }] },
    ])
    const models = (await adapter.native!('listModels', {}, ctx)) as Array<{
      id: string
      features: string[]
    }>
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    )
    expect(models.map((m) => m.id)).toEqual(['qwen3.8-max'])
    expect(models[0]?.features).toContain('structured')
  })

  it('listModels：业务空间模式不支持拉取', async () => {
    const { ctx, fetch } = setup([], { settings: { ...defaults, workspaceId: 'ws-1' } })
    await expect(adapter.native!('listModels', {}, ctx)).rejects.toThrow(/业务空间/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('MCP 目录承诺的参数（白名单透传）', () => {
  it('图片：平铺的 negative_prompt / prompt_extend / watermark / thinking / n / parameters 到达请求体，白名单外丢弃', async () => {
    const { ctx, body } = setup([imageResult, imageResult])
    await submit(ctx, {
      capability: 'image.generate',
      model: 'qwen-image-3.0-pro',
      input: {
        prompt: 'p',
        negative_prompt: '模糊',
        prompt_extend: true,
        watermark: true,
        thinking: true,
        n: 2,
        seed: 5,
        parameters: {
          prompt_extend_mode: 'direct',
          smart_crop: 1,
          size: '1*1',
          n: 9,
          model: 'evil',
        },
      } as unknown as CapabilityInput<'image.generate'>,
    })
    expect(body().parameters).toMatchObject({
      negative_prompt: '模糊',
      prompt_extend: true,
      watermark: true,
      enable_thinking: true,
      prompt_extend_mode: 'direct',
      n: 2,
      seed: 5,
    })
    // parameters 整体透传未知官方字段，但不能覆盖适配器自己构造的键
    expect(body().parameters).toMatchObject({ smart_crop: 1, n: 2 })
    expect(body().parameters.size).not.toBe('1*1')
    expect(body().model).toBe('qwen-image-3.0-pro')
    await submit(ctx, {
      capability: 'image.generate',
      model: 'wan2.7-image-pro',
      input: {
        prompt: 'p',
        thinking: true,
        size: '2K',
      } as unknown as CapabilityInput<'image.generate'>,
    })
    expect(body(1).parameters).toMatchObject({ thinking_mode: true })
  })

  it('视频：平铺的 prompt_extend / watermark / ratio 到达请求体', async () => {
    const { ctx, body } = setup([{ output: { task_id: 't' } }])
    await submit(ctx, {
      capability: 'video.generate',
      model: 'wan3.0-video',
      input: {
        prompt: 'p',
        prompt_extend: true,
        watermark: true,
        ratio: '9:16',
      } as unknown as CapabilityInput<'video.generate'>,
    })
    expect(body().parameters).toMatchObject({ prompt_extend: true, watermark: true, ratio: '9:16' })
  })

  it('视频：parameters 的未知官方字段到达请求体，保留字段不被覆盖', async () => {
    const { ctx, body } = setup([{ output: { task_id: 't' } }])
    await submit(ctx, {
      capability: 'video.generate',
      model: 'wan3.0-video',
      input: {
        prompt: 'p',
        duration: 5,
        parameters: { shot_type: 'multi', duration: 99, resolution: '4K', model: 'evil' },
      } as unknown as CapabilityInput<'video.generate'>,
    })
    expect(body().parameters).toMatchObject({ shot_type: 'multi', duration: 5, resolution: '720P' })
    expect(body().model).toBe('wan3.0-video')
  })

  it('语音：parameters 合并进 input 且不能覆盖 text / voice，language 与 instructions 平铺字段生效', async () => {
    const { ctx, body } = setup([
      { output: { audio: { url: 'https://x.oss-cn-beijing.aliyuncs.com/a.wav' } } },
    ])
    await submit(ctx, {
      capability: 'audio.speech',
      model: 'qwen3-tts-flash',
      input: {
        text: '你好',
        voice: 'Cherry',
        language: 'Chinese',
        parameters: { seed: 7, text: 'evil', voice: 'evil' },
      } as unknown as CapabilityInput<'audio.speech'>,
    })
    expect(body().input).toMatchObject({
      text: '你好',
      voice: 'Cherry',
      language_type: 'Chinese',
      seed: 7,
    })
  })
})
