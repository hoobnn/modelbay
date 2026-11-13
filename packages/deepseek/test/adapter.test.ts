import { createAdapterContext } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createDeepseekAdapter, deepseekAdapter, deepseekPlatform, models } from '../src/index'

const ctx = createAdapterContext({
  secrets: { DEEPSEEK_API_KEY: 'test' },
  fetchImpl: (async () => Response.json({ data: [] })) as typeof fetch,
})
describe('DeepSeek platform', () => {
  it('registers runtime-agnostic adapters and native discovery', async () => {
    expect(deepseekPlatform.createAdapters()[0]?.channels).toEqual(['deepseek'])
    expect(deepseekAdapter.models).toBe(models)
    expect(deepseekAdapter.nativeOperations).toContain('responses')
    expect(await deepseekAdapter.native!('list-remote-models', {}, ctx)).toEqual({ data: [] })
    expect(
      await deepseekAdapter.submit(
        {
          capability: 'text.chat',
          model: 'deepseek-flash',
          input: { messages: [] },
          native: { op: 'list-remote-models', params: {} },
        },
        ctx,
      ),
    ).toMatchObject({ state: 'succeeded', outputs: [{ type: 'json', value: { data: [] } }] })
  })
  it('rejects mismatched and retired models before sending', async () => {
    await expect(
      deepseekAdapter.submit(
        { capability: 'text.chat', model: 'missing', input: { messages: [] } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      deepseekAdapter.submit(
        { capability: 'image.generate', model: 'deepseek-flash', input: { prompt: 'x' } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const adapter = createDeepseekAdapter([
      { ...models[0]!, lifecycle: { ...models[0]!.lifecycle, status: 'retired' } },
    ])
    await expect(
      adapter.submit(
        { capability: 'text.chat', model: 'deepseek-flash', input: { messages: [] } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('resolves qualified model refs to the real API ID', async () => {
    const adapter = createDeepseekAdapter()
    await expect(
      adapter.submit(
        { capability: 'text.chat', model: 'deepseek:deepseek-flash', input: { messages: [] } },
        ctx,
      ),
    ).rejects.toThrow('对话至少需要一条消息')
  })
})
