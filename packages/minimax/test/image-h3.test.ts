/** MiniMax-H3-Image：文生图 / 图片编辑的请求形状、尺寸映射、逐张失败与错误码。 */
import { describe, expect, it } from 'vite-plus/test'
import { minimaxAdapter } from '../src/index'
import { hostContext, httpResponse } from './helpers'

// https://platform.minimax.cn/docs/api-reference/image-generation-h3-generations
// https://platform.minimax.cn/docs/api-reference/image-generation-h3-edits
const image = { assetId: 'image', kind: 'image' as const }
const MODEL = 'MiniMax-H3-Image'
const ok = (urls: string[], extra = {}) => ({
  created: 1,
  data: urls.map((url) => ({ url, size: '2048x2048', revised_prompt: 'p' })),
  output_format: 'jpeg',
  usage: { generated_images: urls.length },
  ...extra,
})

function submit(input: Record<string, unknown>, replies: unknown[] = [], model = MODEL) {
  const f = hostContext(replies as never)
  const result = minimaxAdapter.submit(
    { capability: 'image.generate', model, input: { prompt: '一只猫', ...input } as never },
    f.ctx,
  )
  return { f, result }
}

// 流式响应：等待期间的 keepalive 注释、按完成先后推送的逐张事件
const sse = (events: Array<Record<string, unknown>>) =>
  new Response(
    [': keepalive', ...events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}`)]
      .map((block) => `${block}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )

const url = (f: ReturnType<typeof hostContext>) => String(f.fetch.mock.calls[0]?.[0])

describe('MiniMax-H3-Image', () => {
  it('流式结果按 image_index 还原，逐张失败只记日志', async () => {
    const { f, result } = submit({ count: 3, extra: { output_format: 'webp' } }, [
      sse([
        {
          type: 'image_generation.partial_succeeded',
          image_index: 1,
          url: 'https://e.com/2.webp',
          output_format: 'webp',
        },
        {
          type: 'image_generation.partial_failed',
          image_index: 2,
          code: '1027',
          message: 'unsafe',
        },
        {
          type: 'image_generation.partial_succeeded',
          image_index: 0,
          url: 'https://e.com/1.webp',
          output_format: 'webp',
        },
        { type: 'image_generation.completed', usage: { generated_images: 2 }, request_id: 'r' },
      ]),
    ])
    const out = await result
    expect(
      out.state === 'succeeded' && out.outputs.map((o) => o.type === 'file' && [o.url, o.mime]),
    ).toEqual([
      ['https://e.com/1.webp', 'image/webp'],
      ['https://e.com/2.webp', 'image/webp'],
    ])
    expect(f.ctx.log).toHaveBeenCalled()
  })

  it('流式 error 事件按其中的 HTTP 状态码与业务码归类；没有结束事件视为中断', async () => {
    const failed = submit({}, [
      sse([
        {
          type: 'image_generation.partial_failed',
          image_index: 0,
          code: '1027',
          message: 'unsafe',
        },
        {
          type: 'error',
          error: { type: 'unprocessable_entity_error', message: 'unsafe (1027)', http_code: '422' },
          usage: {},
        },
      ]),
    ])
    await expect(failed.result).rejects.toMatchObject({ code: 'content_policy' })

    const cut = submit({}, [
      sse([
        { type: 'image_generation.partial_succeeded', image_index: 0, url: 'https://e.com/1.jpeg' },
      ]),
    ])
    await expect(cut.result).rejects.toMatchObject({
      code: 'unknown',
      retryable: false,
      outcome: 'unknown',
    })
  })

  it('文生图：画幅与分辨率映射成 aspect_ratio / area，固定 url 返回', async () => {
    const { f, result } = submit(
      { count: 2, resolution: '2K', extra: { aspectRatio: '16:9', output_format: 'png' } },
      [ok(['https://e.com/1.png', 'https://e.com/2.png'], { output_format: 'png' })],
    )
    const out = await result
    expect(url(f)).toBe('https://api.minimax.cn/v1/images/generations')
    expect(f.body()).toEqual({
      model: MODEL,
      prompt: '一只猫',
      n: 2,
      aspect_ratio: '16:9',
      area: '2K',
      output_format: 'png',
      response_format: 'url',
      stream: true,
    })
    expect(out.state === 'succeeded' && out.outputs).toEqual([
      { type: 'file', kind: 'image', mime: 'image/png', url: 'https://e.com/1.png' },
      { type: 'file', kind: 'image', mime: 'image/png', url: 'https://e.com/2.png' },
    ])
  })

  it('宽高换成 宽x高，不再传画幅和面积档；超出面积范围在提交前拒绝', async () => {
    const { f, result } = submit(
      { width: 2720, height: 1536, resolution: '4K', extra: { aspectRatio: '1:1' } },
      [ok(['https://e.com/1.jpeg'])],
    )
    await result
    expect(f.body()).toMatchObject({ size: '2720x1536' })
    expect(f.body()).not.toHaveProperty('aspect_ratio')
    expect(f.body()).not.toHaveProperty('area')

    const small = submit({ extra: { size: '512*512' } })
    await expect(small.result).rejects.toMatchObject({ code: 'invalid_input' })
    expect(small.f.fetch).not.toHaveBeenCalled()
  })

  it('有参考图走图片编辑，参考图按 image_url 传，不传 disable_prompt_enhanced', async () => {
    const { f, result } = submit({ references: [image, image] }, [ok(['https://e.com/1.jpeg'])])
    await result
    expect(url(f)).toBe('https://api.minimax.cn/v1/images/edits')
    expect(f.body().images).toEqual([
      { image_url: 'data:image/png;base64,AQID' },
      { image_url: 'data:image/png;base64,AQID' },
    ])
    expect(f.body()).not.toHaveProperty('disable_prompt_enhanced')

    const edit = submit({ references: [image], extra: { disable_prompt_enhanced: true } })
    await expect(edit.result).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('关闭提示词增强时必须给出比例', async () => {
    const bad = submit({ extra: { disable_prompt_enhanced: true } })
    await expect(bad.result).rejects.toThrow('关闭提示词增强')
    const { f, result } = submit({ extra: { disable_prompt_enhanced: true, aspectRatio: '3:4' } }, [
      ok(['https://e.com/1.jpeg']),
    ])
    await result
    expect(f.body()).toMatchObject({ disable_prompt_enhanced: true, aspect_ratio: '3:4' })
  })

  it('上下限取自声明：张数、参考图数量、高速版同样生效', async () => {
    await expect(submit({ count: 11 }).result).rejects.toMatchObject({ code: 'invalid_input' })
    const many = Array.from({ length: 17 }, () => image)
    await expect(submit({ references: many }).result).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const fast = submit({}, [ok(['https://e.com/1.jpeg'])], 'MiniMax-H3-Image-Highspeed')
    await fast.result
    expect(fast.f.body().model).toBe('MiniMax-H3-Image-Highspeed')
  })

  it('部分失败只返回成功的；全部失败按逐张错误码归类', async () => {
    const partial = submit({ count: 2 }, [
      {
        data: [{ url: 'https://e.com/1.jpeg' }, { error: { code: '1027', message: 'unsafe' } }],
        output_format: 'jpeg',
      },
    ])
    const out = await partial.result
    expect(out.state === 'succeeded' && out.outputs).toHaveLength(1)
    expect(partial.f.ctx.log).toHaveBeenCalled()

    const none = submit({}, [{ data: [{ error: { code: '1027', message: 'unsafe' } }] }])
    await expect(none.result).rejects.toMatchObject({ code: 'content_policy' })
  })

  it('OpenAI 风格的 HTTP 错误按 message 末尾的业务码归类', async () => {
    const body = {
      type: 'error',
      error: {
        type: 'unprocessable_entity_error',
        message: 'input content failed safety check: prompt (1026)',
        http_code: '422',
      },
    }
    const { result } = submit({}, [httpResponse(422, body)])
    await expect(result).rejects.toMatchObject({ code: 'content_policy' })
    const quota = submit({}, [
      httpResponse(402, {
        error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)' },
      }),
    ])
    await expect(quota.result).rejects.toMatchObject({ code: 'quota' })
  })
})
