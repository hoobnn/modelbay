/** MiniMax 适配器在宿主下的用例：请求构造、校验、解析、错误、轮询、远端模型列表。 */
import { describe, expect, it } from 'vite-plus/test'
import type { AdapterRequest, AssetRef, CapabilityInput } from '@modelbay/core'
import { minimaxAdapter } from '../src/index'
import { hostContext } from './helpers'

const adapter = minimaxAdapter
const frame: AssetRef = { assetId: 'frame', kind: 'image', mime: 'image/png' }
const submit = (request: AdapterRequest, ctx: Parameters<typeof adapter.submit>[1]) =>
  adapter.submit(request, ctx)
const chatInput = (extra: Partial<CapabilityInput<'text.chat'>> = {}) => ({
  messages: [{ role: 'user' as const, content: '你好' }],
  ...extra,
})

describe('对话', () => {
  it('使用 max_completion_tokens 并返回用量', async () => {
    const { ctx, body } = hostContext([
      {
        choices: [{ message: { content: '回答' } }],
        usage: { prompt_tokens: 4, completion_tokens: 6 },
      },
    ])
    const result = await submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3.1-Flash',
        input: chatInput({ maxTokens: 100 }),
      },
      ctx,
    )
    expect(body()).toMatchObject({
      max_completion_tokens: 100,
      stream: false,
      reasoning_split: true,
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ type: 'text', text: '回答' }],
      usage: { inputTokens: 4, outputTokens: 6 },
    })
  })

  it('M3.1 Flash 把 AssetRef 经 files.read 转 data URI', async () => {
    const { ctx, body } = hostContext([{ choices: [{ message: { content: '一只猫' } }] }])
    await submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3.1-Flash',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '描述图片' },
                { type: 'image', image: frame },
              ],
            },
          ],
        },
      },
      ctx,
    )
    expect(body().messages[0].content).toEqual([
      { type: 'text', text: '描述图片' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ])
  })

  it('M2.7 拒绝图片，在计费请求前失败', async () => {
    const { ctx, fetch } = hostContext()
    await expect(
      submit(
        {
          capability: 'text.chat',
          model: 'MiniMax-M2.7',
          input: { messages: [{ role: 'user', content: [{ type: 'image', image: frame }] }] },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', message: '当前模型不支持图片输入' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('声明 vision 的对话模型只有 M3 与 M3.1 Flash', () => {
    const vision = adapter.models.filter((m) => m.features?.includes('vision')).map((m) => m.id)
    expect(vision.sort()).toEqual(['MiniMax-M3', 'MiniMax-M3.1-Flash'])
    for (const id of ['MiniMax-M3', 'MiniMax-M3.1-Flash', 'MiniMax-M2.7'])
      expect(adapter.models.find((m) => m.id === id)?.features).toContain('structured')
  })

  const schema = {
    type: 'object',
    properties: { shots: { type: 'array', items: { type: 'string' } } },
    required: ['shots'],
  }
  it('结构化生成把 Schema 写入指令、剥离代码围栏并本地校验', async () => {
    const { ctx, body } = hostContext([
      { choices: [{ message: { content: '```json\n{"shots":["雨停了"]}\n```' } }] },
    ])
    const result = await submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3',
        input: chatInput({ jsonSchema: schema }),
      },
      ctx,
    )
    expect(body().messages[0]).toMatchObject({ role: 'system' })
    expect(body().messages[0].content).toContain('"shots"')
    expect(result).toMatchObject({ outputs: [{ type: 'json', value: { shots: ['雨停了'] } }] })
  })
  it.each([
    ['not JSON', 'stop'],
    ['{"shots":4}', 'stop'],
    ['{"shots":[]}', 'length'],
  ])('拒绝无效或截断的结构化输出：%s / %s', async (content, finish_reason) => {
    const { ctx } = hostContext([{ choices: [{ message: { content }, finish_reason }] }])
    await expect(
      submit(
        { capability: 'text.chat', model: 'MiniMax-M3', input: chatInput({ jsonSchema: schema }) },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'unknown', retryable: false })
  })

  it('extra 不能覆盖保留字段，其余字段透传', async () => {
    const { ctx, body } = hostContext([{ choices: [{ message: { content: '好' } }] }])
    await submit(
      {
        capability: 'text.chat',
        model: 'MiniMax-M3',
        input: chatInput({
          extra: {
            model: 'evil',
            messages: [],
            stream: true,
            tools: [1],
            response_format: {},
            reasoning_split: false,
            top_p: 0.8,
          },
        }),
      },
      ctx,
    )
    expect(body()).toMatchObject({
      model: 'MiniMax-M3',
      stream: false,
      reasoning_split: true,
      top_p: 0.8,
    })
    expect(body().messages).toHaveLength(1)
    expect(body()).not.toHaveProperty('tools')
    expect(body()).not.toHaveProperty('response_format')
  })

  it('remoteOnly 只放开对话；未带标记或其它能力仍拒绝', async () => {
    const { ctx, fetch } = hostContext([
      {
        choices: [{ message: { content: '好' } }],
        input_sensitive: false,
        output_sensitive: false,
      },
    ])
    await expect(
      submit(
        { capability: 'text.chat', model: 'brand-new', remoteOnly: true, input: chatInput() },
        ctx,
      ),
    ).resolves.toMatchObject({ state: 'succeeded' })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/v1/chat/completions')
    const init = fetch.mock.calls[0]![1] as RequestInit
    expect(String(init.body)).toContain('brand-new')
    await expect(
      submit({ capability: 'text.chat', model: 'brand-new', input: chatInput() }, ctx),
    ).rejects.toThrow(/不匹配/)
    await expect(
      submit(
        {
          capability: 'image.generate',
          model: 'image-brand-new',
          remoteOnly: true,
          input: { prompt: 'x' },
        },
        ctx,
      ),
    ).rejects.toThrow(/不匹配/)
  })
})

describe('图片', () => {
  const ok = { data: { image_urls: ['https://cdn.hailuoai.com/image.jpg'] } }
  const image = (model: string, input: Partial<CapabilityInput<'image.generate'>>) =>
    ({ capability: 'image.generate', model, input: { prompt: '画一只猫', ...input } }) as const

  it('参考图编码为 data URI；保留 aspectRatio', async () => {
    const { ctx, body } = hostContext([ok])
    await submit(image('image-01', { references: [frame], extra: { aspectRatio: '16:9' } }), ctx)
    expect(body()).toMatchObject({
      aspect_ratio: '16:9',
      subject_reference: [{ type: 'character', image_file: 'data:image/png;base64,AQID' }],
    })
  })
  it('分辨率档位按长边换算宽高，不再传 aspect_ratio', async () => {
    const { ctx, body } = hostContext([ok])
    await submit(image('image-01', { resolution: '2K', extra: { aspectRatio: '16:9' } }), ctx)
    expect(body()).toMatchObject({ width: 2048, height: 1152 })
    expect(body().aspect_ratio).toBeUndefined()
  })
  it('1K + 21:9 联网前拒绝，默认比例与 2K 保持超宽画幅', async () => {
    const { ctx, fetch, body } = hostContext([ok, ok])
    await expect(
      submit(image('image-01', { resolution: '1K', extra: { aspectRatio: '21:9' } }), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
    await submit(image('image-01', { extra: { aspectRatio: '21:9' } }), ctx)
    expect(body()).toMatchObject({ aspect_ratio: '21:9' })
    await submit(image('image-01', { resolution: '2K', extra: { aspectRatio: '21:9' } }), ctx)
    const sent = body(1)
    expect(sent.width / sent.height).toBeCloseTo(21 / 9, 1)
    expect(sent.aspect_ratio).toBeUndefined()
  })
  it('live 使用官方 style 对象，支持人物参考和九张输出', async () => {
    const { ctx, body } = hostContext([
      { data: { image_urls: Array.from({ length: 9 }, () => 'https://cdn.hailuoai.com/a.png') } },
    ])
    const result = await submit(
      image('image-01-live', {
        count: 9,
        references: [frame],
        extra: {
          aspectRatio: '3:4',
          style_type: '水彩',
          style_weight: 0.6,
          prompt_optimizer: true,
          aigc_watermark: false,
        },
      }),
      ctx,
    )
    expect(body()).toMatchObject({
      model: 'image-01-live',
      n: 9,
      aspect_ratio: '3:4',
      style: { style_type: '水彩', style_weight: 0.6 },
      prompt_optimizer: true,
      aigc_watermark: false,
      subject_reference: [{ type: 'character' }],
    })
    expect(body()).not.toHaveProperty('style_type')
    expect(result).toMatchObject({ usage: { images: 9 } })
  })
  it('选了画风没给权重时默认 0.8', async () => {
    const { ctx, body } = hostContext([ok])
    await submit(image('image-01-live', { extra: { style_type: '漫画' } }), ctx)
    expect(body().style).toEqual({ style_type: '漫画', style_weight: 0.8 })
  })
  it.each<Partial<CapabilityInput<'image.generate'>>>([
    { extra: { aspectRatio: '21:9' } },
    { resolution: '1K' },
    { width: 1024, height: 1024 },
    { extra: { style_type: 'unknown' } },
    { extra: { style_type: '水彩', style_weight: 0 } },
    { extra: { style_weight: 0.5 } },
  ])('live 不支持的参数在联网前拒绝：%j', async (input) => {
    const { ctx, fetch } = hostContext()
    await expect(submit(image('image-01-live', input), ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('自定义宽高与反向提示词按声明在联网前拒绝', async () => {
    const { ctx, fetch } = hostContext()
    await expect(submit(image('image-01', { width: 500, height: 512 }), ctx)).rejects.toMatchObject(
      {
        code: 'invalid_input',
        message: 'image-01 的自定义宽高须为 512–2048 像素且为 8 的倍数，现在是 500×512',
      },
    )
    await expect(
      submit(image('image-01-live', { width: 1024, height: 1024 }), ctx),
    ).rejects.toMatchObject({
      message: 'image-01-live 不支持自定义宽高，请改用画幅和分辨率',
    })
    await expect(
      submit(image('image-01', { negativePrompt: '不要文字' }), ctx),
    ).rejects.toMatchObject({
      message: 'image-01 不支持反向提示词，请把内容合并到提示词里',
    })
    await expect(
      submit(image('image-01', { references: [frame, frame] }), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('目录声明图片、语音与音乐的文本长度上限', () => {
    const limit = (id: string) => adapter.models.find((m) => m.id === id)?.limits?.promptMaxLength
    expect([limit('image-01'), limit('image-01-live')]).toEqual([1500, 1500])
    expect([limit('speech-2.8-hd'), limit('speech-2.8-turbo'), limit('music-3.0')]).toEqual([
      9999, 9999, 2000,
    ])
  })
})

describe('H3 视频提交与轮询', () => {
  const video = (model: string, input: Partial<CapabilityInput<'video.generate'>>) =>
    ({ capability: 'video.generate', model, input: { prompt: '跳舞', ...input } }) as const

  it('首尾帧走 V2 并使用 adaptive，默认分辨率取模型声明', async () => {
    const { ctx, body, fetch } = hostContext([{ task_id: 'task-1' }])
    const result = await submit(
      video('MiniMax-H3', {
        firstFrame: frame,
        lastFrame: frame,
        duration: 5,
        aspectRatio: '16:9',
      }),
      ctx,
    )
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.minimax.cn/v2/video_generation')
    expect(body()).toMatchObject({
      resolution: '2K',
      ratio: 'adaptive',
      content: [{ type: 'text', text: '跳舞' }, { role: 'first_frame' }, { role: 'last_frame' }],
    })
    expect(result).toMatchObject({ state: 'pending', remoteId: 'task-1' })
  })
  it('Highspeed 接受 480P 并在提交前拒绝 2K', async () => {
    const { ctx, body, fetch } = hostContext([{ task_id: 'task-480' }])
    await expect(
      submit(video('MiniMax-H3-Highspeed', { resolution: '480P' }), ctx),
    ).resolves.toMatchObject({ remoteId: 'task-480' })
    expect(body()).toMatchObject({ resolution: '480P' })
    await expect(
      submit(video('MiniMax-H3-Highspeed', { resolution: '2K' }), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('H3-Max 不支持 2K 且时长至少 5 秒；Lite 默认 768P', async () => {
    const { ctx, fetch, body } = hostContext([{ task_id: 'lite' }])
    await expect(submit(video('MiniMax-H3-Max', { resolution: '2K' }), ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(submit(video('MiniMax-H3-Max', { duration: 4 }), ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(fetch).not.toHaveBeenCalled()
    await submit(video('MiniMax-H3-Lite', { duration: 4 }), ctx)
    expect(body()).toMatchObject({ resolution: '768P', duration: 4, ratio: '16:9' })
  })
  it('seed 与缺回执：不重复付费', async () => {
    const a = hostContext()
    await expect(submit(video('MiniMax-H3', { seed: 1 }), a.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const b = hostContext([{}])
    await expect(submit(video('MiniMax-H3', {}), b.ctx)).rejects.toMatchObject({
      code: 'unknown',
      retryable: false,
    })
    expect(b.fetch).toHaveBeenCalledTimes(1)
  })
  it('轮询 queued → succeeded 从 task.content.url 获取视频', async () => {
    const { ctx } = hostContext([
      { task: { id: 't1', status: 'queued' } },
      {
        task: {
          id: 't1',
          status: 'succeeded',
          content: { url: 'https://cdn.hailuoai.com/video.mp4' },
          duration: 5,
        },
      },
    ])
    expect(await adapter.poll!('t1', ctx)).toMatchObject({ state: 'pending' })
    expect(await adapter.poll!('t1', ctx)).toMatchObject({
      state: 'succeeded',
      outputs: [{ kind: 'video', url: 'https://cdn.hailuoai.com/video.mp4' }],
      usage: { seconds: 5 },
    })
  })
  it('未知任务状态不当作成功', async () => {
    const { ctx } = hostContext([
      { task: { id: 't1', status: 'weird', content: { url: 'https://cdn.hailuoai.com/v.mp4' } } },
    ])
    await expect(adapter.poll!('t1', ctx)).rejects.toMatchObject({ code: 'unknown' })
  })
  it('取消先查状态，不 DELETE 成功记录', async () => {
    const { ctx, fetch } = hostContext([{ task: { id: 't1', status: 'succeeded' } }])
    await adapter.cancel!('t1', ctx)
    expect(fetch).toHaveBeenCalledTimes(1)
    const queued = hostContext([{ task: { id: 't2', status: 'queued' } }, {}])
    await adapter.cancel!('t2', queued.ctx)
    expect(queued.fetch).toHaveBeenLastCalledWith(
      'https://api.minimax.cn/v2/video_generation/t2',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
  it.each([{ task: { id: 'other', status: 'queued' } }, {}])(
    '取消查询缺少匹配任务时不发 DELETE：%j',
    async (reply) => {
      const { ctx, fetch } = hostContext([reply])
      await expect(adapter.cancel!('t1', ctx)).rejects.toMatchObject({ code: 'unknown' })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
    },
  )
})

describe('语音、音乐与错误', () => {
  it('hex 配音转二进制并归一化毫秒用量；默认音色取 settings.voice', async () => {
    const { ctx, body } = hostContext(
      [{ data: { audio: '0102ff' }, extra_info: { audio_length: 1500, usage_characters: 2 } }],
      { settings: { voice: 'custom-voice' } },
    )
    const result = await submit(
      { capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: '你好', speed: 1.2 } },
      ctx,
    )
    expect(body()).toMatchObject({
      output_format: 'hex',
      voice_setting: { voice_id: 'custom-voice', speed: 1.2 },
    })
    expect(result).toMatchObject({
      outputs: [{ mime: 'audio/mpeg', data: new Uint8Array([1, 2, 255]) }],
      usage: { seconds: 1.5, characters: 2 },
    })
  })
  it('音乐使用 instrumental，时长是软约束', async () => {
    const { ctx, body } = hostContext([{ data: { audio: '0102' } }])
    await submit(
      {
        capability: 'audio.music',
        model: 'music-3.0',
        input: { prompt: '轻快弦乐', duration: 30 },
      },
      ctx,
    )
    expect(body()).toMatchObject({ is_instrumental: true, output_format: 'hex', lyrics: '' })
    expect(body()).not.toHaveProperty('duration')
    expect(ctx.log).toHaveBeenCalled()
  })
  it('music 410 归为 unavailable 且不可重试', async () => {
    const { ctx } = hostContext([
      Response.json(
        { error: { type: 'not_supported', message: 'no longer available' } },
        { status: 410 },
      ),
    ])
    await expect(
      submit({ capability: 'audio.music', model: 'music-3.0', input: { prompt: 'piano' } }, ctx),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: false })
  })
  it('HTTP 200 中业务错误归一化并脱敏', async () => {
    const { ctx } = hostContext([
      { base_resp: { status_code: 1008, status_msg: 'balance test-key' } },
    ])
    await expect(
      submit({ capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: '你好' } }, ctx),
    ).rejects.toMatchObject({ code: 'quota', message: 'MiniMax：balance [redacted]' })
  })
  it.each([
    [1004, 200, 'auth'],
    [2049, 200, 'auth'],
    [1026, 200, 'content_policy'],
    [1043, 200, 'content_policy'],
    [1013, 200, 'unavailable'],
    [2013, 200, 'invalid_input'],
    [9999, 429, 'rate_limit'],
  ] as const)('业务码 %i（HTTP %i）归为 %s', async (code, status, expected) => {
    const { ctx } = hostContext([
      Response.json({ base_resp: { status_code: code, status_msg: 'failed' } }, { status }),
    ])
    await expect(
      submit({ capability: 'audio.speech', model: 'speech-2.8-hd', input: { text: '你好' } }, ctx),
    ).rejects.toMatchObject({ code: expected })
  })
  it('查询遇网关错误页或 429 可重试，提交遇 502 不可重试', async () => {
    const gateway = () => new Response('<html>bad gateway</html>', { status: 502 })
    const { ctx } = hostContext([
      gateway(),
      Response.json(
        { base_resp: { status_code: 1002, status_msg: 'rate limit' } },
        { status: 429 },
      ),
      gateway(),
    ])
    for (let i = 0; i < 2; i++)
      await expect(adapter.poll!('123', ctx)).rejects.toMatchObject({ retryable: true })
    await expect(
      submit({ capability: 'video.generate', model: 'MiniMax-H3', input: { prompt: '跳舞' } }, ctx),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: false })
  })
  it.each([408, 500, 502, 503, 504])('POST HTTP %i 的网关响应保留 unknown', async (status) => {
    for (const response of [
      new Response('<html>gateway</html>', { status }),
      Response.json({ error: { message: 'gateway' } }, { status }),
    ]) {
      const { ctx, fetch } = hostContext([response])
      await expect(
        submit(
          { capability: 'video.generate', model: 'MiniMax-H3', input: { prompt: 'local' } },
          ctx,
        ),
      ).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
  it('地域读 settings.region；缺 settings 时回退 MINIMAX_REGION', async () => {
    const g = hostContext([{ data: { audio: '01' } }], { settings: { region: 'global' } })
    await submit({ capability: 'audio.music', model: 'music-3.0', input: { prompt: 'p' } }, g.ctx)
    expect(String(g.fetch.mock.calls[0]?.[0])).toBe('https://api.minimax.io/v1/music_generation')
    const m = hostContext([{ data: { audio: '01' } }])
    m.ctx.settings = undefined
    m.ctx.secret = (name) => ({ MINIMAX_API_KEY: 'k', MINIMAX_REGION: 'global' })[name]
    await submit({ capability: 'audio.music', model: 'music-3.0', input: { prompt: 'p' } }, m.ctx)
    expect(String(m.fetch.mock.calls[0]?.[0])).toContain('api.minimax.io')
  })
})
