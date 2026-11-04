import { describe, expect, it, vi } from 'vite-plus/test'
import {
  emitUsage,
  emitProgress,
  InMemoryJobStore,
  runJob,
  UrlAssetSource,
  toBase64,
  fromBase64,
  redact,
  redactHeaders,
} from './runtime'
import type { JobRecord } from './runtime'
import type { ProviderOutput } from './provider'

const textOutput: ProviderOutput = { type: 'text', text: 'done' }

interface CaughtError {
  code?: string
  message?: string
  retryable?: boolean
  name?: string
}

const catchError = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error('预期 runJob 抛错但没有')
}

const hooks = () => ({ onUsage: vi.fn(), onProgress: vi.fn(), onLog: vi.fn() })

describe('emitUsage / emitProgress', () => {
  it('有钩子时转发事件', () => {
    const h = hooks()
    emitUsage(h, { inputTokens: 1, platform: 'p' })
    emitProgress(h, { platform: 'p', state: 'submitted' })
    expect(h.onUsage).toHaveBeenCalledWith({ inputTokens: 1, platform: 'p' })
    expect(h.onProgress).toHaveBeenCalledWith({ platform: 'p', state: 'submitted' })
  })

  it('钩子缺省或没有对应方法时不抛错', () => {
    expect(() => emitUsage(undefined, {})).not.toThrow()
    expect(() => emitProgress(undefined, { state: 'queued' })).not.toThrow()
    expect(() => emitUsage({}, {})).not.toThrow()
    expect(() => emitProgress({}, { state: 'running' })).not.toThrow()
  })
})

describe('InMemoryJobStore', () => {
  const record = (overrides: Partial<JobRecord> = {}): JobRecord => ({
    id: 'job-1',
    remoteId: 'r1',
    platform: 'p',
    capability: 'c',
    state: 'pending',
    createdAt: 1,
    ...overrides,
  })

  it('save/get/list 存取记录，且保存的是副本', () => {
    const store = new InMemoryJobStore()
    const rec = record()
    store.save(rec)
    rec.state = 'succeeded'
    expect(store.get('job-1')?.state).toBe('pending')
    expect(store.list()).toHaveLength(1)
    expect(store.get('missing')).toBeUndefined()
  })

  it('同一 id 再次 save 会覆盖', () => {
    const store = new InMemoryJobStore()
    store.save(record())
    store.save(record({ state: 'failed', error: 'boom' }))
    expect(store.list()).toHaveLength(1)
    expect(store.get('job-1')).toMatchObject({ state: 'failed', error: 'boom' })
  })
})

describe('UrlAssetSource', () => {
  it('从注入的 fetch 读取字节、mime 与 url', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const spy = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
    const source = new UrlAssetSource(spy as unknown as typeof fetch)
    const loaded = await source.load('https://x/a.png')
    expect(spy).toHaveBeenCalledWith('https://x/a.png')
    expect(loaded.data).toEqual(bytes)
    expect(loaded.mime).toBe('image/png')
    expect(loaded.url).toBe('https://x/a.png')
  })

  it('没有 content-type 时用默认 mime', async () => {
    const spy = vi.fn(async () => new Response(new Uint8Array([9])))
    const source = new UrlAssetSource(spy as unknown as typeof fetch)
    const loaded = await source.load('https://x/bin')
    expect(loaded.mime).toBe('application/octet-stream')
  })

  it('响应不 ok 时抛 unavailable', async () => {
    const spy = vi.fn(async () => new Response('', { status: 404 }))
    const source = new UrlAssetSource(spy as unknown as typeof fetch)
    const err = (await catchError(source.load('https://x/missing'))) as CaughtError
    expect(err.code).toBe('unavailable')
    expect(err.message).toContain('HTTP 404')
  })
})

describe('toBase64 / fromBase64', () => {
  it('Hello 的已知编码与解码', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111])
    expect(toBase64(bytes)).toBe('SGVsbG8=')
    expect(fromBase64('SGVsbG8=')).toEqual(bytes)
  })

  it('往返任意字节（含超过 0x8000 的分块）', () => {
    const bytes = new Uint8Array(70000)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('空字节与空字符串', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
    expect(fromBase64('')).toEqual(new Uint8Array(0))
  })
})

describe('redact / redactHeaders', () => {
  it('脱敏 Bearer、sk- 与 api key', () => {
    expect(redact('Authorization: Bearer abc.def-_')).toBe('Authorization: Bearer <redacted>')
    expect(redact('token sk-abcdef123 end')).toBe('token sk-<redacted> end')
    expect(redact('api_key: XYZ_123')).toBe('api_key: <redacted>')
    expect(redact('apikey=tok123')).toBe('apikey=<redacted>')
    expect(redact('BEARER TOKEN123')).toBe('BEARER <redacted>')
    expect(redact('nothing here')).toBe('nothing here')
  })

  it('多个敏感值一起脱敏', () => {
    expect(redact('Bearer aaa and sk-bbb and api_key: ccc')).toBe(
      'Bearer <redacted> and sk-<redacted> and api_key: <redacted>',
    )
  })

  it('redactHeaders 按头名整值脱敏，其余按值脱敏', () => {
    const headers = {
      Authorization: 'Bearer secret',
      'X-Api-Key': 'abc',
      'x-token': 'xyz',
      Signature: 'sig',
      'x-secret': 's',
      'content-type': 'Bearer abc.def',
      Accept: 'application/json',
    }
    expect(redactHeaders(headers)).toEqual({
      Authorization: '<redacted>',
      'X-Api-Key': '<redacted>',
      'x-token': '<redacted>',
      Signature: '<redacted>',
      'x-secret': '<redacted>',
      'content-type': 'Bearer <redacted>',
      Accept: 'application/json',
    })
  })

  it('空头表返回空对象', () => {
    expect(redactHeaders({})).toEqual({})
  })
})

describe('runJob', () => {
  it('同步成功：返回输出与用量，上报 submitted/succeeded 与 usage', async () => {
    const h = hooks()
    const outcome = await runJob({
      submit: async () => ({
        state: 'succeeded' as const,
        outputs: [textOutput],
        usage: { inputTokens: 5 },
      }),
      platform: 'p',
      capability: 'text.chat',
      hooks: h,
    })
    expect(outcome.outputs).toEqual([textOutput])
    expect(outcome.usage).toEqual({ inputTokens: 5 })
    expect(outcome.remoteId).toBeUndefined()
    expect(h.onProgress).toHaveBeenCalledWith({ platform: 'p', state: 'submitted' })
    expect(h.onProgress).toHaveBeenCalledWith({ platform: 'p', state: 'succeeded' })
    expect(h.onUsage).toHaveBeenCalledWith({
      inputTokens: 5,
      platform: 'p',
      capability: 'text.chat',
    })
  })

  it('同步成功且没有 usage / hooks 也不抛', async () => {
    const outcome = await runJob({
      submit: async () => ({ state: 'succeeded' as const, outputs: [textOutput] }),
      platform: 'p',
      capability: 'text.chat',
    })
    expect(outcome.outputs).toEqual([textOutput])
    expect(outcome.usage).toBeUndefined()
  })

  it('异步但没有实现 poll 时抛 unavailable', async () => {
    const err = (await catchError(
      runJob({
        submit: async () => ({ state: 'pending' as const, remoteId: 'r1' }),
        platform: 'p',
        capability: 'c',
      }),
    )) as CaughtError
    expect(err.code).toBe('unavailable')
  })

  it('pending → poll → succeeded：保存记录并上报', async () => {
    const h = hooks()
    const store = new InMemoryJobStore()
    const poll = vi.fn(async () => ({
      state: 'succeeded' as const,
      outputs: [textOutput],
      usage: { seconds: 3 },
    }))
    const outcome = await runJob({
      submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
      poll,
      platform: 'p',
      capability: 'c',
      hooks: h,
      store,
      signal: new AbortController().signal,
    })
    expect(poll).toHaveBeenCalledWith('r1')
    expect(outcome.remoteId).toBe('r1')
    expect(outcome.outputs).toEqual([textOutput])
    expect(outcome.usage).toEqual({ seconds: 3 })
    const records = store.list()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      remoteId: 'r1',
      platform: 'p',
      capability: 'c',
      state: 'succeeded',
    })
    expect(records[0]?.outputs).toEqual([textOutput])
    expect(records[0]?.usage).toEqual({ seconds: 3 })
    expect(h.onProgress).toHaveBeenCalledWith({
      platform: 'p',
      remoteId: 'r1',
      state: 'succeeded',
    })
    expect(h.onUsage).toHaveBeenCalledWith({ seconds: 3, platform: 'p', capability: 'c' })
  })

  it('pending（running + progress）→ succeeded', async () => {
    const h = hooks()
    let call = 0
    const poll = vi.fn(async () => {
      call += 1
      return call === 1
        ? { state: 'pending' as const, progress: 0.5, remote: 'running' as const, pollAfterMs: 0 }
        : { state: 'succeeded' as const, outputs: [textOutput] }
    })
    await runJob({
      submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
      poll,
      platform: 'p',
      capability: 'c',
      hooks: h,
    })
    expect(poll).toHaveBeenCalledTimes(2)
    expect(h.onProgress).toHaveBeenCalledWith({
      platform: 'p',
      remoteId: 'r1',
      state: 'running',
      progress: 0.5,
    })
  })

  it('pending（queued 且无 progress、沿用 wait）→ succeeded', async () => {
    const h = hooks()
    let call = 0
    const poll = vi.fn(async () => {
      call += 1
      return call === 1
        ? { state: 'pending' as const }
        : { state: 'succeeded' as const, outputs: [textOutput] }
    })
    await runJob({
      submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
      poll,
      platform: 'p',
      capability: 'c',
      hooks: h,
    })
    expect(h.onProgress).toHaveBeenCalledWith({ platform: 'p', remoteId: 'r1', state: 'queued' })
  })

  it('pending → failed：保存失败记录并抛对应错误', async () => {
    const h = hooks()
    const store = new InMemoryJobStore()
    const poll = vi.fn(async () => ({
      state: 'failed' as const,
      error: { code: 'content_policy' as const, message: 'blocked', retryable: false },
    }))
    const err = (await catchError(
      runJob({
        submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
        poll,
        platform: 'p',
        capability: 'c',
        hooks: h,
        store,
      }),
    )) as CaughtError
    expect(err.code).toBe('content_policy')
    expect(err.message).toBe('blocked')
    expect(err.retryable).toBe(false)
    expect(store.list()[0]).toMatchObject({ state: 'failed', error: 'blocked' })
    expect(h.onProgress).toHaveBeenCalledWith({ platform: 'p', remoteId: 'r1', state: 'failed' })
  })

  it('failed 未给 retryable 时按错误码默认', async () => {
    const poll = vi.fn(async () => ({
      state: 'failed' as const,
      error: { code: 'rate_limit' as const, message: 'slow down' },
    }))
    const err = (await catchError(
      runJob({
        submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
        poll,
        platform: 'p',
        capability: 'c',
      }),
    )) as CaughtError
    expect(err.code).toBe('rate_limit')
    expect(err.retryable).toBe(true)
  })

  it('超过 maxWaitMs 抛 timeout', async () => {
    const poll = vi.fn(async () => ({ state: 'pending' as const }))
    const err = (await catchError(
      runJob({
        submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
        poll,
        platform: 'p',
        capability: 'c',
        maxWaitMs: -1,
      }),
    )) as CaughtError
    expect(err.code).toBe('timeout')
    expect(poll).not.toHaveBeenCalled()
  })

  it('信号已中止时抛 cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = (await catchError(
      runJob({
        submit: async () => ({ state: 'pending' as const, remoteId: 'r1', pollAfterMs: 0 }),
        poll: async () => ({ state: 'succeeded' as const, outputs: [] }),
        platform: 'p',
        capability: 'c',
        signal: controller.signal,
      }),
    )) as CaughtError
    expect(err.code).toBe('cancelled')
  })

  it('等待期间中止信号会取消 delay（覆盖缺省等待 1000ms）', async () => {
    const controller = new AbortController()
    const poll = vi.fn(async () => ({ state: 'succeeded' as const, outputs: [] }))
    const running = runJob({
      submit: async () => ({ state: 'pending' as const, remoteId: 'r1' }),
      poll,
      platform: 'p',
      capability: 'c',
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 5)
    const err = (await catchError(running)) as CaughtError
    expect(err.code).toBe('cancelled')
    expect(poll).not.toHaveBeenCalled()
  })
})
