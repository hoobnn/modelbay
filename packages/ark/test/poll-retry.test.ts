import { describe, expect, it } from 'vite-plus/test'
import { arkAdapter } from '../src/index'
import { fakeContext, jsonResponse } from './helpers'

describe('方舟视频轮询的重试', () => {
  it('可重试的 GET 失败只再试 1 次', async () => {
    const f = fakeContext([
      jsonResponse({ error: { code: 'ServerOverloaded', message: 'busy' } }, 503),
      jsonResponse({ id: 'cgt-1', status: 'running' }),
    ])
    expect(await arkAdapter.poll!('cgt-1', f.ctx)).toMatchObject({ state: 'pending' })
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })

  it('连续两次失败后抛出，不再第三次请求', async () => {
    const busy = () => jsonResponse({ error: { code: 'ServerOverloaded', message: 'busy' } }, 503)
    const f = fakeContext([busy(), busy(), jsonResponse({ id: 'cgt-1', status: 'running' })])
    await expect(arkAdapter.poll!('cgt-1', f.ctx)).rejects.toMatchObject({ retryable: true })
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })
})
