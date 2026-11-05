/**
 * 宿主通过 adapter 调用时的请求构造 / 校验 / 解析 / 错误 / 签名用例
 * （mock fetch，断言请求体、拒绝条件、错误 code 与输出）。
 */
import { describe, expect, it, vi } from 'vite-plus/test'
import { createAdapterContext, type AdapterContext, type LoadedFile } from '@modelbay/core'
import { createDoubaoAdapter } from '../src/adapter'
import { all } from '../src/models/index'

const adapter = createDoubaoAdapter(all)

interface Options {
  secrets?: Record<string, string>
  mime?: string
  duration?: number
  settings?: Record<string, unknown>
  file?: Partial<LoadedFile>
  submission?: AdapterContext['submission']
}

function setup(replies: Array<Response | Record<string, unknown>> = [], opts: Options = {}) {
  const queue = [...replies]
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected fetch')
    return next instanceof Response ? next : Response.json(next)
  })
  const read = vi.fn(async (): Promise<LoadedFile> => ({
    data: new Uint8Array([1, 2, 3]),
    mime: opts.mime ?? 'audio/wav',
    ...(opts.duration === undefined ? {} : { duration: opts.duration }),
    ...opts.file,
  }))
  const log = vi.fn()
  const ctx = createAdapterContext({
    fetchImpl: fetch as unknown as typeof globalThis.fetch,
    secrets: opts.secrets ?? { VOLC_SPEECH_API_KEY: 'test-key' },
    settings: opts.settings ?? {
      voice: 'zh_female_vv_uranus_bigtts',
      format: 'mp3',
      sampleRate: '24000',
    },
    files: { read },
    log,
    ...(opts.submission ? { submission: opts.submission } : {}),
  })
  const body = (n = 0) => JSON.parse(String(fetch.mock.calls[n]![1]!.body))
  return { ctx, fetch, read, log, body }
}

const speech = (model = 'seed-tts-2.0', input: Record<string, unknown> = { text: 'fixture' }) =>
  ({ capability: 'audio.speech', model, input }) as never
const sample = { assetId: 'a', kind: 'audio' as const }

describe('HTTP 契约', () => {
  it.each([500, 502, 503, 504])(
    'HTTP %s 保留请求 ID、平台 logid 与提交未知，不自动重试',
    async (status) => {
      const { ctx, fetch } = setup([
        new Response('gateway timeout', { status, headers: { 'X-Tt-Logid': 'platform-log-504' } }),
      ])
      const error = await adapter.submit(speech(), ctx).catch((e: unknown) => e)
      const id = new Headers(fetch.mock.calls[0]![1]!.headers).get('X-Api-Request-Id')!
      expect(error).toMatchObject({
        code: status === 504 ? 'timeout' : 'unavailable',
        outcome: 'unknown',
        retryable: false,
        message: expect.stringContaining(id),
      })
      expect((error as Error).message).toContain('platform-log-504')
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('音频包与结束包里的 null 音频被接受', async () => {
    const { ctx } = setup([
      new Response(
        '{"code":0,"data":"AQID"}\n{"code":0,"data":null,"sentence":{}}\n{"code":20000000,"data":null}',
      ),
    ])
    expect(await adapter.submit(speech(), ctx)).toMatchObject({
      state: 'succeeded',
      outputs: [{ data: new Uint8Array([1, 2, 3]) }],
    })
  })

  it('流式 PCM 拼成单个容器的 mono 16-bit WAV', async () => {
    const { ctx, body } = setup(
      [new Response('{"code":0,"data":"AAD/"}\n{"code":20000000,"data":"fwCA"}')],
      { settings: { format: 'wav', sampleRate: '48000' } },
    )
    const result = await adapter.submit(speech(), ctx)
    if (result.state !== 'succeeded') throw new Error('expected audio')
    const output = result.outputs[0]!
    if (output.type !== 'file' || !output.data) throw new Error('expected file')
    const wav = Buffer.from(output.data)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
    expect(wav.readUInt32LE(24)).toBe(48000)
    expect(wav.readUInt32LE(28)).toBe(96000)
    expect(wav.readUInt32LE(40)).toBe(6)
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)]).toEqual([
      0, 32767, -32768,
    ])
    expect(output).toMatchObject({ name: 'doubao.wav', mime: 'audio/wav' })
    expect(body().req_params.audio_params).toMatchObject({ format: 'pcm', sample_rate: 48000 })
  })

  it('远端错误信息里的全部凭证都脱敏', async () => {
    const values = {
      VOLC_SPEECH_API_KEY: 'sensitive-key',
      VOLC_SPEECH_APP_ID: 'app-123',
      VOLC_SPEECH_ACCESS_KEY: 'access-456',
    }
    const { ctx } = setup(
      [
        new Response(
          JSON.stringify({ code: '45000001', message: Object.values(values).join(' ') }),
          { status: 400 },
        ),
      ],
      { secrets: values },
    )
    await expect(adapter.submit(speech(), ctx)).rejects.toMatchObject({
      message: expect.stringContaining('豆包语音 45000001: [redacted] [redacted] [redacted]'),
    })
  })

  it.each(['network', 'body', 'parse'] as const)(
    '%s 失败仍保留核查标识和提交未知状态',
    async (mode) => {
      const response =
        mode === 'body'
          ? new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError('terminated'))
                },
              }),
              { headers: { 'X-Tt-Logid': 'stream-log-id' } },
            )
          : new Response('{"code":0,"data":"AQID"}', { headers: { 'X-Tt-Logid': 'stream-log-id' } })
      const { ctx, fetch, log } = setup([response])
      if (mode === 'network') fetch.mockRejectedValueOnce(new TypeError('disconnected'))
      const error = await adapter
        .submit(speech('seed-tts-2.0', { text: 'private fixture text' }), ctx)
        .catch((e: unknown) => e)
      const id = new Headers(fetch.mock.calls[0]![1]?.headers).get('X-Api-Request-Id')!
      expect(error).toMatchObject({
        code: 'unavailable',
        retryable: false,
        outcome: 'unknown',
        message: expect.stringContaining(id),
      })
      if (mode !== 'network') expect((error as Error).message).toContain('stream-log-id')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(log.mock.calls)).not.toContain('private fixture text')
      expect(JSON.stringify(log.mock.calls)).not.toContain('test-key')
    },
  )

  it('响应 logid 中的配置密钥同样脱敏', async () => {
    const { ctx, log } = setup([
      new Response('timeout', { status: 504, headers: { 'X-Tt-Logid': 'test-key' } }),
    ])
    const error = await adapter.submit(speech(), ctx).catch((e: unknown) => e)
    expect((error as Error).message).toContain('平台日志 ID [redacted]')
    expect((error as Error).message).not.toContain('test-key')
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-key')
  })

  it('分块响应读到一半断开时提交结果未知，不可重试', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"code":0,'))
          controller.error(new TypeError('terminated'))
        },
      }),
    )
    await expect(adapter.submit(speech(), setup([broken]).ctx)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: false,
    })
  })

  it('缺少凭证在联网前报 auth', async () => {
    const { ctx, fetch } = setup([], { secrets: {} })
    await expect(adapter.submit(speech(), ctx)).rejects.toMatchObject({ code: 'auth' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('NDJSON 与相邻 JSON 对象拼接音频，设置与语速进入请求', async () => {
    const raw =
      '{"code":0,"data":"AQI="}\n{"code":0,"data":"AwQ="}{"code":20000000,"message":"end } \\""}'
    const { ctx, fetch, body } = setup([new Response(raw)])
    const result = await adapter.submit(
      speech('seed-tts-2.0', { text: '你好', speed: 1.25, instruction: '温柔' }),
      ctx,
    )
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [{ data: new Uint8Array([1, 2, 3, 4]), mime: 'audio/mpeg' }],
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional')
    expect(init?.headers).toMatchObject({
      'X-Api-Key': 'test-key',
      'X-Api-Resource-Id': 'seed-tts-2.0',
    })
    expect(body().req_params.audio_params.speech_rate).toBe(25)
    expect(JSON.parse(body().req_params.additions)).toEqual({ context_texts: ['温柔'] })
  })

  it('设置里的音色、格式、采样率进入合成请求，缺省回退 MCP 的 VOLC_SPEECH_*', async () => {
    const a = setup([new Response('{"code":20000000,"data":"AQI="}')], {
      settings: { voice: 'zh_male_m191_uranus_bigtts', format: 'mp3', sampleRate: '16000' },
    })
    await adapter.submit(speech('seed-tts-2.0', { text: 'x' }), a.ctx)
    expect(a.body().req_params).toMatchObject({
      speaker: 'zh_male_m191_uranus_bigtts',
      audio_params: { format: 'mp3', sample_rate: 16000 },
    })
    const raw = createAdapterContext({
      fetchImpl: (async () => new Response('{"code":20000000,"data":"AQI="}')) as never,
      secrets: {
        VOLC_SPEECH_API_KEY: 'k',
        VOLC_SPEECH_VOICE: 'zh_male_taocheng_uranus_bigtts',
        VOLC_SPEECH_SAMPLE_RATE: '48000',
      },
    })
    const spy = vi.spyOn(raw, 'fetch')
    await adapter.submit(speech('seed-tts-2.0', { text: 'x' }), raw)
    const sent = JSON.parse(String(spy.mock.calls[0]![1]!.body))
    expect(sent.req_params).toMatchObject({
      speaker: 'zh_male_taocheng_uranus_bigtts',
      audio_params: { sample_rate: 48000 },
    })
  })

  it('旧版 App Key + Access Key 鉴权，凭证不进请求体', async () => {
    const { ctx, fetch } = setup([new Response('{"code":20000000,"data":"AQI="}')], {
      secrets: { VOLC_SPEECH_APP_ID: 'app', VOLC_SPEECH_ACCESS_KEY: 'access' },
    })
    await adapter.submit(speech('seed-icl-2.0', { text: '你好', voice: 'S_example' }), ctx)
    const init = fetch.mock.calls[0]![1]!
    expect(init.headers).toMatchObject({ 'X-Api-App-Key': 'app', 'X-Api-Access-Key': 'access' })
    expect(init.headers).not.toHaveProperty('X-Api-Key')
    expect(String(init.body)).not.toContain('access')
  })

  it.each([
    '{"code":0,"data":"AQI="}',
    '{"code":20000000,"data":"!bad!"}',
    '{"code":0,"data":"AQI="}{',
  ])('拒绝不完整或损坏的音频', async (raw) => {
    await expect(adapter.submit(speech(), setup([new Response(raw)]).ctx)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: false,
    })
  })

  it('Seed Audio 的时长与类型作为提示词前缀', async () => {
    const { ctx, fetch, body } = setup([new Response('{"code":20000000,"audio":"AQI="}')])
    await adapter.submit(
      {
        capability: 'audio.music',
        model: 'seed-audio-1.0',
        input: { prompt: '钢琴', duration: 10 },
      },
      ctx,
    )
    expect(fetch.mock.calls[0]![0]).toBe('https://openspeech.bytedance.com/api/v3/tts/create')
    expect(body()).toMatchObject({
      model: 'seed-audio-1.0',
      text_prompt: expect.stringContaining('目标时长 10 秒'),
    })
  })

  it('Seed Audio 的小数时长仍按 3000 字上限提交', async () => {
    for (const duration of [12.5, 119.5]) {
      const { ctx, body } = setup([new Response('{"code":20000000,"audio":"AQI="}')])
      await adapter.submit(
        {
          capability: 'audio.sfx',
          model: 'seed-audio-1.0',
          input: { prompt: '音'.repeat(2971), duration },
        },
        ctx,
      )
      expect(body().text_prompt).toContain(`目标时长 ${duration} 秒。`)
      expect(body().text_prompt.length).toBeLessThanOrEqual(3000)
    }
    const { ctx, fetch } = setup()
    await expect(
      adapter.submit(
        {
          capability: 'audio.sfx',
          model: 'seed-audio-1.0',
          input: { prompt: '音'.repeat(2972), duration: 119.5 },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('读取素材后以内联 base64 提交极速识别', async () => {
    const { ctx, read, fetch, body } = setup([
      new Response('{"result":{"text":"你好"}}', { headers: { 'X-Api-Status-Code': '20000000' } }),
    ])
    const result = await adapter.submit(
      {
        capability: 'audio.transcribe',
        model: 'bigmodel',
        input: { audio: { assetId: 'fixture', kind: 'audio' }, language: 'zh-CN' },
      },
      ctx,
    )
    expect(result).toEqual({ state: 'succeeded', outputs: [{ type: 'text', text: '你好' }] })
    expect(read).toHaveBeenCalledWith({ assetId: 'fixture', kind: 'audio' })
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({
      'X-Api-Sequence': '-1',
      'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
    })
    expect(body().audio).toEqual({ data: 'AQID', format: 'wav', language: 'zh-CN' })
  })

  it('分句时间换成秒返回', async () => {
    const { ctx, body } = setup([
      new Response(
        JSON.stringify({
          result: {
            text: '你好。再见。',
            utterances: [
              { text: '你好。', start_time: 120, end_time: 900 },
              { text: '再见。', start_time: 1000, end_time: 1800 },
            ],
          },
        }),
        { headers: { 'X-Api-Status-Code': '20000000' } },
      ),
    ])
    const result = await adapter.submit(
      { capability: 'audio.transcribe', model: 'bigmodel', input: { audio: sample } },
      ctx,
    )
    expect(result).toEqual({
      state: 'succeeded',
      outputs: [
        { type: 'text', text: '你好。再见。' },
        {
          type: 'json',
          value: {
            segments: [
              { start: 0.12, end: 0.9, text: '你好。' },
              { start: 1, end: 1.8, text: '再见。' },
            ],
          },
        },
      ],
    })
    expect(body().request).toMatchObject({ show_utterances: true })
  })

  it('平台静音状态码返回空文本', async () => {
    const { ctx } = setup([new Response('{}', { headers: { 'X-Api-Status-Code': '20000003' } })])
    await expect(
      adapter.submit(
        { capability: 'audio.transcribe', model: 'bigmodel', input: { audio: sample } },
        ctx,
      ),
    ).resolves.toEqual({ state: 'succeeded', outputs: [{ type: 'text', text: '' }] })
  })

  it.each([
    [401, undefined, 'auth'],
    [429, undefined, 'rate_limit'],
    [503, undefined, 'unavailable'],
    [200, '45000001', 'invalid_input'],
  ])('HTTP 与业务错误归类 (%s, %s)', async (status, code, expected) => {
    const { ctx } = setup([
      new Response('{"message":"failed"}', {
        status,
        headers: code ? { 'X-Api-Status-Code': code } : {},
      }),
    ])
    await expect(
      adapter.submit(speech('seed-tts-2.0', { text: 'hello' }), ctx),
    ).rejects.toMatchObject({ code: expected })
  })

  it.each(['invalid sample_rate: 44100', 'max tokens exceeds model limit'])(
    '400 参数错误“%s”归为 invalid_input',
    async (message) => {
      const { ctx } = setup([
        new Response(JSON.stringify({ code: 45000000, message }), { status: 400 }),
      ])
      await expect(
        adapter.submit(speech('seed-tts-2.0', { text: 'hello' }), ctx),
      ).rejects.toMatchObject({
        code: 'invalid_input',
      })
    },
  )

  it('模型与能力不匹配时在读素材、联网前拒绝', async () => {
    const { ctx, fetch, read } = setup()
    await expect(
      adapter.submit(speech('seed-audio-1.0', { text: 'hello' }), ctx),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('合成 2.0 收到复刻音色时改走复刻 2.0 资源', async () => {
    const { ctx, fetch } = setup([new Response('{"code":20000000,"data":"AQI="}')])
    await adapter.submit(speech('seed-tts-2.0', { text: '你好', voice: 'S_abc' }), ctx)
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'X-Api-Resource-Id': 'seed-icl-2.0' })
  })

  it('明确选择复刻 1.0 时使用对应资源，并拒绝普通音色', async () => {
    const { ctx, fetch } = setup([new Response('{"code":20000000,"data":"AQI="}')])
    await adapter.submit(speech('seed-icl-1.0', { text: '你好', voice: 'S_abc' }), ctx)
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'X-Api-Resource-Id': 'seed-icl-1.0' })
    const other = setup()
    await expect(
      adapter.submit(
        speech('seed-icl-1.0', { text: '你好', voice: 'zh_female_vv_uranus_bigtts' }),
        other.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(other.fetch).not.toHaveBeenCalled()
  })

  it('资源与音色不匹配时提示核实版本，且不自动重试', async () => {
    const { ctx, fetch } = setup([
      new Response(
        '{"code":55000000,"message":"resource ID is mismatched with speaker related resource"}',
      ),
    ])
    await expect(
      adapter.submit(speech('seed-icl-2.0', { text: '你好', voice: 'S_abc' }), ctx),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      retryable: false,
      message: expect.stringContaining('声音复刻 1.0 或 2.0'),
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('自定义音色合成走复刻资源', async () => {
    const { ctx, fetch } = setup([
      new Response('{"code":0,"data":"AQID"}\n{"code":20000000,"data":null}'),
    ])
    await adapter.submit(speech('seed-tts-2.0', { text: '测试', voice: 'pleinabcdefgh' }), ctx)
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'X-Api-Resource-Id': 'seed-icl-2.0' })
  })

  it('目录声明语音与 Seed Audio 的有效文本长度上限', () => {
    const limit = (id: string) => all.find((m) => m.id === id)?.limits?.promptMaxLength
    for (const id of ['seed-tts-2.0', 'seed-icl-1.0', 'seed-icl-2.0']) expect(limit(id)).toBe(3000)
    expect(limit('seed-audio-1.0')).toBe(2971)
  })
})

describe('MCP 目录参数', () => {
  it('渠道前缀的模型 ID 与 instructions 参数都能到达请求', async () => {
    const { ctx, fetch, body } = setup([new Response('{"code":20000000,"data":"AQI="}')])
    await adapter.submit(
      speech('doubao-speech:seed-tts-2.0', { text: '你好', instructions: '温柔' }),
      ctx,
    )
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'X-Api-Resource-Id': 'seed-tts-2.0' })
    expect(JSON.parse(body().req_params.additions)).toEqual({ context_texts: ['温柔'] })
  })
})

describe('submission 回传', () => {
  it('响应头到达时回传脱敏的 logId 与状态，请求 ID 用宿主给的', async () => {
    const response = vi.fn()
    const { ctx, fetch } = setup(
      [
        new Response('{"code":20000000,"data":"AQI="}', {
          headers: { 'X-Tt-Logid': 'log-1   test-key' },
        }),
      ],
      { submission: { requestId: 'req-fixed', response } },
    )
    await adapter.submit(speech(), ctx)
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('X-Api-Request-Id')).toBe('req-fixed')
    expect(response).toHaveBeenCalledWith({ logId: 'log-1 [redacted]', httpStatus: 200 })
  })
})

describe('媒体声明的运行前约束', () => {
  const big = (mb: number) => ({ length: mb * 1024 * 1024 }) as Uint8Array
  it('识别音频超过声明的 100 MB 时在联网前拒绝', async () => {
    const { ctx, fetch } = setup([], { file: { data: big(120) } })
    await expect(
      adapter.submit(
        { capability: 'audio.transcribe', model: 'bigmodel', input: { audio: sample } },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: '识别音频大小 120 MB，超过 录音文件识别极速版 的 100 MB 上限，请压缩后再运行',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('识别音频是空文件时按声明的最小大小拒绝', async () => {
    const { ctx, fetch } = setup([], { file: { data: new Uint8Array(0) } })
    await expect(
      adapter.submit(
        { capability: 'audio.transcribe', model: 'bigmodel', input: { audio: sample } },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: '识别音频只有 0 字节，录音文件识别极速版 要求不小于 1 字节，请更换素材',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('复刻样本超过 10 MB 时在联网前拒绝', async () => {
    const { ctx, fetch } = setup([], { file: { data: big(11) } })
    await expect(adapter.voiceClone.clone({ voiceId: 'S_abc', sample }, ctx)).rejects.toMatchObject(
      {
        code: 'invalid_input',
        message: '复刻样本大小 11 MB，超过 豆包声音复刻 的 10 MB 上限，请压缩后再运行',
      },
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('声音复刻与音色设计', () => {
  it('复刻上传样本到控制台分配的音色 ID，训练状态按 get_voice 归一', async () => {
    const { ctx, fetch, body } = setup(
      [
        { speaker_id: 'S_abc' },
        { speaker_id: 'S_abc', status: 0 },
        { speaker_id: 'S_abc', status: 4 },
        { speaker_id: 'S_abc', status: 3 },
      ],
      { mime: 'audio/mpeg' },
    )
    await expect(adapter.voiceClone.clone({ voiceId: 'S_abc', sample }, ctx)).resolves.toEqual({
      status: 'training',
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/voice_clone')
    expect(init!.headers).not.toHaveProperty('X-Api-Resource-Id')
    expect(body()).toMatchObject({ speaker_id: 'S_abc', audio: { data: 'AQID', format: 'mp3' } })
    const status = adapter.voiceClone.status
    await expect(status('S_abc', ctx)).resolves.toEqual({ status: 'training' })
    await expect(status('S_abc', ctx)).resolves.toEqual({ status: 'ready' })
    await expect(status('S_abc', ctx)).resolves.toMatchObject({ status: 'failed' })
    expect(fetch.mock.calls[1]![0]).toBe('https://openspeech.bytedance.com/api/v3/tts/get_voice')
  })

  it('复刻只接受 S_ 音色 ID，平台错误码照常报出', async () => {
    await expect(
      adapter.voiceClone.clone({ voiceId: 'abc', sample }, setup().ctx),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const { ctx } = setup([{ code: 45001105, message: 'speaker permission denied' }])
    await expect(adapter.voiceClone.clone({ voiceId: 'S_abc', sample }, ctx)).rejects.toThrow(
      'speaker permission denied',
    )
  })

  it('四秒样本不按建议时长拦截，自定义 ID 使用后付费协议，默认关闭降噪和归一化', async () => {
    const { ctx, body } = setup([{ status: 2 }], { duration: 4 })
    await expect(
      adapter.voiceClone.clone({ voiceId: 'pleinabcdefgh', idMode: 'custom', sample }, ctx),
    ).resolves.toEqual({ status: 'ready' })
    expect(body()).toMatchObject({
      speaker_id: 'custom_speaker_id',
      custom_speaker_id: 'pleinabcdefgh',
      language: 0,
      extra_params: { enable_audio_denoise: false, disable_volume_normalization: true },
    })
  })

  it('试听 demo_audio 仅下载 bytespeech 的 https 地址并嗅探格式；下载失败不影响状态', async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    const { ctx, fetch } = setup([
      { status: 2, demo_audio: 'https://x.bytespeech.com/a.bin' },
      new Response(wav),
      { status: 2, demo_audio: 'https://evil.example.com/a.wav' },
      { status: 2, demo_audio: 'https://x.bytespeech.com/a.bin' },
      new Response('not audio'),
    ])
    const ready = await adapter.voiceClone.status('S_abc', ctx)
    expect(ready).toMatchObject({ status: 'ready', preview: { mime: 'audio/wav' } })
    expect(ready.preview!.data).toEqual(wav)
    expect(await adapter.voiceClone.status('S_abc', ctx)).toEqual({ status: 'ready' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(await adapter.voiceClone.status('S_abc', ctx)).toEqual({ status: 'ready' })
  })

  it('文字和图片设计使用独立接口，成功状态立即可用', async () => {
    const { ctx, body, fetch } = setup([{ status: 4 }], { mime: 'image/png' })
    await expect(
      adapter.voiceDesign.design(
        {
          voiceId: 'S_abc',
          prompt: '温柔女声',
          previewText: '这是一段试听文本。',
          image: { assetId: 'a', kind: 'image' },
        },
        ctx,
      ),
    ).resolves.toEqual({ status: 'ready' })
    expect(fetch.mock.calls[0]![0]).toBe('https://openspeech.bytedance.com/api/v3/tts/voice_design')
    expect(body()).toMatchObject({
      speaker_id: 'S_abc',
      text: '这是一段试听文本。',
      prompt: { text_prompt: '温柔女声', image_prompt: { image_bytes: 'AQID' } },
    })
  })

  it('设计参数越界在提交前拒绝；平台失败状态保留', async () => {
    const { ctx, fetch } = setup([{ status: 3, message: '训练失败' }])
    await expect(
      adapter.voiceDesign.design(
        { voiceId: 'S_abc', prompt: 'a'.repeat(201), previewText: '试听' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
    await expect(
      adapter.voiceDesign.design({ voiceId: 'S_abc', prompt: '女声', previewText: '试听' }, ctx),
    ).resolves.toMatchObject({ status: 'failed' })
  })
})
