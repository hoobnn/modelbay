/**
 * 方舟套餐渠道（Agent Plan 数据面）。
 *
 * 断言请求体、请求头、套餐模型名与「计费请求前失败」的行为。
 */
import { describe, expect, it } from 'vite-plus/test'
import { arkPlanAdapter, models } from '../src/index'
import { fakeContext } from './helpers'

/** 按量 ID：套餐渠道要翻译成套餐 ID 再发出去。 */
const PLAN_IMAGE = 'doubao-seedream-5-0-pro-260628'
const PLAN_VIDEO = 'doubao-seedance-2-5-260628'

const PLAN_SECRET = { ARK_AGENT_PLAN_API_KEY: 'plan-secret' }

describe('套餐渠道：图片走专属数据面、专属 Key 和套餐模型名', () => {
  it('按量 ID 发进套餐渠道，模型名换成套餐 ID', async () => {
    const { ctx, fetch, body } = fakeContext([{ data: [{ b64_json: 'AQID' }] }], {
      secret: PLAN_SECRET,
    })
    await arkPlanAdapter.submit(
      { capability: 'image.generate', model: PLAN_IMAGE, input: { prompt: 'apple' } },
      ctx,
    )
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer plan-secret',
      'Content-Type': 'application/json',
    })
    expect(body().model).toBe('doubao-seedream-5.0-pro')
  })
})

describe('套餐渠道：视频提交与轮询都在套餐数据面', () => {
  it('提交与轮询都走 /api/plan/v3，模型名是套餐 ID', async () => {
    const { ctx, fetch, body } = fakeContext(
      [{ id: 'cgt-1' }, { id: 'cgt-1', status: 'running' }],
      { secret: PLAN_SECRET },
    )
    const submitted = await arkPlanAdapter.submit(
      { capability: 'video.generate', model: PLAN_VIDEO, input: { prompt: 'sea' } },
      ctx,
    )
    expect(body().model).toBe('doubao-seedance-2.5')
    expect(submitted).toMatchObject({ remoteId: 'cgt-1' })
    await arkPlanAdapter.poll?.('cgt-1', ctx)
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/cgt-1',
    )
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer plan-secret' })
  })
})

describe('套餐渠道：不支持的模型在计费请求前失败', () => {
  it('Seedream Lite 不在套餐里', async () => {
    const { ctx, fetch } = fakeContext([], { secret: PLAN_SECRET })
    await expect(
      arkPlanAdapter.submit(
        {
          capability: 'image.generate',
          model: 'ark-plan:doubao-seedream-5-0-260128',
          input: { prompt: 'apple' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('套餐不支持草稿模式', async () => {
    const { ctx, fetch } = fakeContext([], { secret: PLAN_SECRET })
    await expect(
      arkPlanAdapter.submit(
        {
          capability: 'video.generate',
          model: PLAN_VIDEO,
          input: { prompt: 'sea', extra: { draft: true }, resolution: '480p' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('套餐渠道：模型名从声明派生', () => {
  it('按量 ID 与套餐 ID 解析到同一条声明，发出去的 ID 一样', async () => {
    for (const ref of ['ark-plan:doubao-seedance-2-5-260628', 'ark-plan:doubao-seedance-2.5']) {
      const { ctx, body } = fakeContext([{ id: 'cgt-1' }], { secret: PLAN_SECRET })
      await arkPlanAdapter.submit(
        { capability: 'video.generate', model: ref, input: { prompt: 'sea' } },
        ctx,
      )
      expect(body().model, ref).toBe('doubao-seedance-2.5')
    }
  })

  it('声明里的 ark-plan ID 与对照表逐条一致', () => {
    const expected: Record<string, string> = {
      'doubao-seedream-5-0-pro-260628': 'doubao-seedream-5.0-pro',
      'doubao-seedream-5-0-flash-260915': 'doubao-seedream-5.0-flash',
      'doubao-seedance-2-5-260628': 'doubao-seedance-2.5',
      'doubao-seedance-2-0-260128': 'doubao-seedance-2.0',
      'doubao-seedance-2-0-fast-260128': 'doubao-seedance-2.0-fast',
      'doubao-seedance-2-0-mini-260615': 'doubao-seedance-2.0-mini',
    }
    for (const [apiId, planId] of Object.entries(expected)) {
      const declaration = models.find((item) =>
        item.channels.some((c) => c.channel === 'ark' && c.id === apiId),
      )
      expect(declaration, apiId).toBeDefined()
      expect(declaration?.channels.find((c) => c.channel === 'ark-plan')?.id, apiId).toBe(planId)
    }
  })
})
