import { describe, expect, it } from 'vite-plus/test'
import type { AdapterRequest } from '@modelbay/core'
import { arkAdapter, arkPlanAdapter, channels, models } from '../src/index'
import { fakeContext, fixture, jsonResponse, type RecordedCall } from './helpers'

/** 对话的 SSE 应答。 */
function sseSay(content: string): Response {
  const frames = [
    { choices: [{ index: 0, delta: { role: 'assistant', content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]
  return new Response(
    `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

function request(
  capability: AdapterRequest['capability'],
  model = 'ark:test-model',
  usage?: 'agent',
): AdapterRequest {
  return {
    capability,
    model,
    ...(usage ? { usage } : {}),
    input: { messages: [{ role: 'user', content: '你好' }] },
  }
}

describe('适配器导出', () => {
  it('两个适配器、channels、models 都按契约导出', () => {
    expect(arkAdapter.id).toBe('volc/ark')
    expect(arkAdapter.channels).toEqual(['ark'])
    expect(arkPlanAdapter.id).toBe('volc/ark-plan')
    expect(arkPlanAdapter.channels).toEqual(['ark-plan'])
    expect(channels).toEqual(['ark', 'ark-plan'])
    expect(Array.isArray(models)).toBe(true)
    expect(arkAdapter.nativeOperations).toContain('listModels')
    expect(arkAdapter.nodeOnly).toContain('tos')
    expect(typeof arkAdapter.poll).toBe('function')
    expect(typeof arkAdapter.cancel).toBe('function')
  })
})

describe('arkAdapter.submit：文本对话', () => {
  it('按 /api/v3/chat/completions 构造请求并解析响应', async () => {
    const recorded = fixture<RecordedCall>('chat-success')
    const { ctx, fetch } = fakeContext([sseSay('你好')], {
      secret: { ARK_API_KEY: 'sk-recorded-key' },
    })
    const result = await arkAdapter.submit(request('text.chat'), ctx)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer sk-recorded-key')
    expect(result.state).toBe('succeeded')
  })

  it('缺少 ARK_API_KEY 抛 auth', async () => {
    const { ctx } = fakeContext([], { secret: {} })
    await expect(arkAdapter.submit(request('text.chat'), ctx)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('不支持的能力抛 invalid_input', async () => {
    const { ctx } = fakeContext([], { secret: { ARK_API_KEY: 'k' } })
    await expect(arkAdapter.submit(request('audio.music'), ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('arkPlanAdapter：套餐数据面', () => {
  it('套餐走 /api/plan/v3，模型名用套餐概览页上的写法', async () => {
    const { ctx, fetch } = fakeContext([sseSay('hi')], {
      secret: { ARK_AGENT_PLAN_API_KEY: 'sk-recorded-key' },
    })
    await arkPlanAdapter.submit(request('text.chat', 'ark-plan:doubao-seed-2.1-pro', 'agent'), ctx)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions')
    expect(JSON.parse(String(init.body)).model).toBe('doubao-seed-2.1-pro')
  })

  it('套餐文本调用没有 usage=agent 时在请求前被拦截', async () => {
    const { ctx, fetch } = fakeContext([], { secret: { ARK_AGENT_PLAN_API_KEY: 'k' } })
    await expect(
      arkPlanAdapter.submit(request('text.chat', 'ark-plan:doubao-seed-2.1-pro'), ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('套餐 TTS 经 @modelbay/doubao-speech 真正复用', async () => {
    const stream = '{"code":0,"data":"AQID"}{"code":20000000,"data":""}'
    const { ctx, fetch } = fakeContext([new Response(stream, { status: 200 })], {
      secret: {
        ARK_AGENT_PLAN_API_KEY: 'plan-key',
        VOLC_SPEECH_API_KEY: 'speech-key',
      },
    })
    const result = await arkPlanAdapter.submit(
      {
        capability: 'audio.speech',
        model: 'ark-plan:doubao-seed-tts-2.0',
        input: { text: '你好' },
      },
      ctx,
    )
    expect(result.state).toBe('succeeded')
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v3/plan/tts/unidirectional')
  })

  it('套餐 ASR 暂未接入，给出 TODO 错误', async () => {
    const { ctx } = fakeContext([], { secret: { ARK_AGENT_PLAN_API_KEY: 'k' } })
    await expect(
      arkPlanAdapter.submit(
        {
          capability: 'audio.transcribe',
          model: 'ark-plan:doubao-seed-asr-2.0',
          input: { audio: { assetId: 'a', kind: 'audio' } },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('图片 / 视频完整提交链路', () => {
  it('图片声明带默认分辨率时走 /images/generations 并解析产物', async () => {
    const recorded = fixture<RecordedCall>('image-success')
    const { ctx, fetch } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { ARK_API_KEY: 'k' },
    })
    const result = await arkAdapter.submit(
      {
        capability: 'image.generate',
        model: 'ark:doubao-seedream-5-0-pro-260628',
        input: { prompt: '一只猫' },
      },
      ctx,
    )
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    expect(result.state).toBe('succeeded')
    if (result.state === 'succeeded') expect(result.outputs).toHaveLength(2)
  })

  it('默认分辨率只能来自声明，未声明时抛 invalid_input', async () => {
    const { ctx } = fakeContext([], { secret: { ARK_API_KEY: 'k' } })
    await expect(
      arkAdapter.submit(
        {
          capability: 'image.generate',
          model: 'ark:doubao-seed-2-1-pro-260628',
          input: { prompt: '猫' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('视频提交返回 pending + remoteId', async () => {
    const recorded = fixture<RecordedCall>('video-submit')
    const { ctx, fetch } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { ARK_API_KEY: 'k' },
    })
    const result = await arkAdapter.submit(
      {
        capability: 'video.generate',
        model: 'ark:doubao-seedance-2-0-260128',
        input: { prompt: '海浪拍岸', audio: true, resolution: '720p' },
      },
      ctx,
    )
    const [url] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(recorded.request.url)
    expect(result).toMatchObject({ state: 'pending', remoteId: 'cgt-2026-recorded-0001' })
  })
})

describe('native / poll / cancel', () => {
  it('listModels 走 /api/v3/models 并归一化条目', async () => {
    const recorded = fixture<RecordedCall>('model-list')
    const { ctx } = fakeContext([jsonResponse(recorded.response.body)], {
      secret: { ARK_API_KEY: 'k' },
    })
    const list = (await arkAdapter.native?.('listModels', {}, ctx)) as unknown[]
    expect(list).toHaveLength(2)
  })

  it('套餐 listModels 指向 node 子路径，未知 op 抛错', async () => {
    const { ctx } = fakeContext([], {
      secret: { ARK_AGENT_PLAN_API_KEY: 'k', ARK_API_KEY: 'k' },
    })
    await expect(arkPlanAdapter.native?.('listModels', {}, ctx)).rejects.toMatchObject({
      code: 'unavailable',
    })
    await expect(arkAdapter.native?.('unknown', {}, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('poll 解析成功任务，cancel 拒绝运行中的任务', async () => {
    const succeeded = fixture<RecordedCall>('video-poll-succeeded')
    const { ctx } = fakeContext([jsonResponse(succeeded.response.body)], {
      secret: { ARK_API_KEY: 'k' },
    })
    expect(await arkAdapter.poll?.('cgt-1', ctx)).toMatchObject({ state: 'succeeded' })

    const { ctx: cancelCtx } = fakeContext([{ status: 'running' }], {
      secret: { ARK_API_KEY: 'k' },
    })
    await expect(arkAdapter.cancel?.('cgt-1', cancelCtx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
