/** 百炼 Token Plan 渠道：套餐 Key 与域名、别名、只接对话，按量渠道拒绝套餐独有模型。 */
import { describe, expect, it } from 'vite-plus/test'
import { bailianAdapter, bailianPlatform, models } from '../src/index'
import { createBailianPlanAdapter, PLAN_API_KEY } from '../src/plan'
import { fakeContext, sse } from './helpers'

const DONE = sse(
  'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
)
const plan = createBailianPlanAdapter(models)
const chat = (model: string) => ({
  capability: 'text.chat' as const,
  model,
  input: { messages: [{ role: 'user' as const, content: '你好' }] },
})

describe('百炼 Token Plan 渠道', () => {
  it('走套餐域名与套餐 Key；官方别名与渠道前缀解析成渠道 ID', async () => {
    for (const model of ['qwen4-max-preview', 'qwen4.0-max-preview', 'bailian-plan:qwen3.8-max']) {
      const { ctx, calls } = fakeContext([DONE.clone()], {
        secrets: { BAILIAN_API_KEY: 'api-key', [PLAN_API_KEY]: 'plan-key' },
      })
      const out = await plan.submit(chat(model), ctx)
      expect(out.state).toBe('succeeded')
      const call = calls()[0]!
      expect(call.url).toBe(
        'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      )
      expect(new Headers(call.headers).get('authorization')).toBe('Bearer plan-key')
      expect(call.body.model).toBe(model.endsWith('3.8-max') ? 'qwen3.8-max' : 'qwen4-max-preview')
    }
  })

  it('没配套餐 Key 报 auth；非对话能力和套餐外模型在发请求前拒绝', async () => {
    const { ctx, fetch } = fakeContext([], { secrets: { BAILIAN_API_KEY: 'api-key' } })
    await expect(plan.submit(chat('qwen4-max-preview'), ctx)).rejects.toMatchObject({
      code: 'auth',
    })
    const keyed = fakeContext([], { secrets: { [PLAN_API_KEY]: 'plan-key' } })
    await expect(
      plan.submit(
        { capability: 'image.generate', model: 'qwen-image-3.0-pro', input: { prompt: '猫' } },
        keyed.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(plan.submit(chat('qwen-image-3.0-pro'), keyed.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(keyed.fetch).not.toHaveBeenCalled()
  })

  it('按量渠道拒绝只在套餐里的模型，不用按量 Key 发出去', async () => {
    const { ctx, fetch } = fakeContext([])
    await expect(bailianAdapter.submit(chat('qwen4-max-preview'), ctx)).rejects.toThrow(
      'bailian-plan',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('平台登记两个渠道：任一渠道的 Key 都能启动', () => {
    expect(bailianPlatform.createAdapters().map((item) => item.channels)).toEqual([
      ['bailian'],
      ['bailian-plan'],
    ])
    expect(bailianPlatform.secrets.required).toEqual([['BAILIAN_API_KEY'], [PLAN_API_KEY]])
  })
})
