import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  assetDataUrl,
  buildContextIrRequest,
  buildRerenderRequest,
  CONTEXT_IR_PATH,
  listVideoTasks,
  MINIMAX_NATIVE_OPERATIONS,
  nativeOperationSchemas,
  RERENDER_PATH,
  runMinimaxNative,
  submitNativeTask,
  uploadFile,
  voiceClone,
  voiceDesign,
} from '../src/native'
import { fakeContext, fixture, type Reply } from './helpers'
import { all } from '../src/models/index'

const models = all

describe('native operation declarations', () => {
  it('declares a schema for every exposed operation', () => {
    expect(Object.keys(nativeOperationSchemas).sort()).toEqual(
      [...MINIMAX_NATIVE_OPERATIONS].sort(),
    )
    expect(MINIMAX_NATIVE_OPERATIONS).toContain('context-ir')
    expect(MINIMAX_NATIVE_OPERATIONS).toContain('video-2k-rerender')
  })
})

describe('context-ir (required native op)', () => {
  it('builds the recorded request', () => {
    const f = fixture('context-ir')
    const built = buildContextIrRequest({ prompt: '一只猫在海边' })
    expect(built.path).toBe(CONTEXT_IR_PATH)
    expect(built.body).toEqual(f.request.body)
  })
  it('accepts an official content array and callback_url', () => {
    const content = [
      { type: 'text', text: '描述' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' }, role: 'reference_image' },
    ]
    const built = buildContextIrRequest({
      content,
      duration: 8,
      ratio: '16:9',
      parameters: { callback_url: 'https://cb' },
    })
    expect(built.body.content).toEqual(content)
    expect(built.body.duration).toBe(8)
    expect(built.body.callback_url).toBe('https://cb')
  })
  it('validates content/prompt exclusivity, text presence, duration and parameters', () => {
    expect(() =>
      buildContextIrRequest({ prompt: 'x', content: [{ type: 'text', text: 'y' }] }),
    ).toThrow(ProviderError)
    expect(() => buildContextIrRequest({})).toThrow(ProviderError)
    expect(() => buildContextIrRequest({ prompt: 'x', duration: 20 })).toThrow(ProviderError)
    expect(() => buildContextIrRequest({ prompt: 'x', parameters: { model: 'y' } })).toThrow(
      ProviderError,
    )
  })
  it('submits and normalizes task_id', async () => {
    const f = fixture('context-ir')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await submitNativeTask(ctx, 'context-ir', { prompt: '一只猫在海边' })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.taskId).toBe('ctx-1')
  })
})

describe('video-2k-rerender (required native op)', () => {
  it('builds the recorded request by source task id', () => {
    const f = fixture('rerender')
    const built = buildRerenderRequest({ source_task_id: 'task-1' })
    expect(built.path).toBe(RERENDER_PATH)
    expect(built.body).toEqual(f.request.body)
  })
  it('builds a content-based 2K request', () => {
    const content = [
      { type: 'text', text: 'prompt' },
      { type: 'video_url', video_url: { url: 'https://x/v.mp4' }, role: 'base_video' },
    ]
    const built = buildRerenderRequest({ content, parameters: { aigc_watermark: true } })
    expect(built.body.resolution).toBe('2K')
    expect(built.body.aigc_watermark).toBe(true)
  })
  it('两种请求体都带必填的 resolution=2K（官方 resolution 必填，默认 2K）', () => {
    expect(buildRerenderRequest({ source_task_id: 'task-1' }).body.resolution).toBe('2K')
    const content = [
      { type: 'video_url', video_url: { url: 'https://x/v.mp4' }, role: 'base_video' },
    ]
    expect(buildRerenderRequest({ content }).body.resolution).toBe('2K')
  })
  it('validates mutual exclusivity, base_video and parameters', () => {
    expect(() =>
      buildRerenderRequest({ source_task_id: 'x', content: [{ type: 'text', text: 'y' }] }),
    ).toThrow(ProviderError)
    expect(() => buildRerenderRequest({})).toThrow(ProviderError)
    expect(() => buildRerenderRequest({ content: [{ type: 'text', text: 'y' }] })).toThrow(
      ProviderError,
    )
    expect(() => buildRerenderRequest({ source_task_id: 'x', parameters: { model: 'y' } })).toThrow(
      ProviderError,
    )
  })
  it('submits and normalizes task_id', async () => {
    const f = fixture('rerender')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await submitNativeTask(ctx, 'video-2k-rerender', { source_task_id: 'task-1' })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(result.taskId).toBe('re-1')
  })
  it('refuses a missing task_id', async () => {
    const { ctx } = fakeContext([{ base_resp: { status_code: 0 } }])
    await expect(submitNativeTask(ctx, 'context-ir', { prompt: 'x' })).rejects.toMatchObject({
      code: 'unknown',
    })
  })
})

describe('upload / voice clone / voice design', () => {
  it('uploadFile sends multipart and returns a safe file_id', async () => {
    const f = fixture('upload')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await uploadFile(ctx, { asset_id: 'a1', purpose: 'voice_clone' })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.rawBody).toBeInstanceOf(FormData)
    expect(result.fileId).toBe('123456789')
  })
  it('uploadFile validates the asset and a missing assets source', async () => {
    const a = fakeContext([], { data: new Uint8Array() })
    await expect(uploadFile(a.ctx, { asset_id: 'a1' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const b = fakeContext([])
    b.ctx.assets = undefined
    await expect(uploadFile(b.ctx, { asset_id: 'a1' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(uploadFile(b.ctx, {})).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('voiceClone uploads the sample then creates the voice', async () => {
    const u = fixture('upload')
    const c = fixture('voice-clone')
    const { ctx, calls } = fakeContext([u.response.body, c.response.body])
    const result = await voiceClone(
      ctx,
      {
        voice_id: 'MyVoice_123',
        audio: { assetId: 'a1' },
        mime: 'audio/mpeg',
      },
      models,
    )
    expect(calls()[0]?.url).toBe(u.request.url)
    expect(calls()[1]?.url).toBe(c.request.url)
    expect(calls()[1]?.body).toEqual(c.request.body)
    expect(result.status).toBe('ready')
  })
  it('voiceClone accepts a public URL and validates the voice id / mime', async () => {
    const c = fakeContext([fixture('voice-clone').response.body])
    await expect(
      voiceClone(c.ctx, { voice_id: 'MyVoice_123', audio: 'https://example.com/a.mp3' }, models),
    ).resolves.toMatchObject({ status: 'ready' })
    const bad = fakeContext([])
    await expect(
      voiceClone(bad.ctx, { voice_id: 'bad', audio: { assetId: 'a1' } }, models),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      voiceClone(
        bad.ctx,
        { voice_id: 'MyVoice_123', audio: { assetId: 'a1' }, mime: 'video/mp4' },
        models,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('voiceDesign posts the design body and returns the generated id', async () => {
    const f = fixture('voice-design')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await voiceDesign(ctx, {
      voice_id: 'DesignVoice_1',
      prompt: '温暖的女声',
      preview_text: '你好，欢迎收听。',
    })
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.voiceId).toBe('generated-voice-1')
  })
  it('voiceDesign 不传 voice_id 时请求体省略该字段，并返回平台生成的 ID', async () => {
    const { ctx, calls } = fakeContext([
      { base_resp: { status_code: 0 }, voice_id: 'auto-1', trial_audio: '00' },
    ])
    const result = await voiceDesign(ctx, { prompt: 'p', preview_text: 't' })
    expect(calls()[0]?.body).toEqual({ prompt: 'p', preview_text: 't' })
    expect(result.voiceId).toBe('auto-1')
  })
  it('voice-clone 的 file_id 接受数字和数字字符串，并按 JSON 整数发送（含超过 2^53 的 int64）', async () => {
    for (const [input, wire] of [
      [263891729178625, '263891729178625'],
      ['263891729178625', '263891729178625'],
      ['9223372036854775807', '9223372036854775807'],
    ] as const) {
      const { ctx, calls } = fakeContext([{ base_resp: { status_code: 0 } }])
      await voiceClone(ctx, { voice_id: 'MyVoice_123', file_id: input }, models)
      const raw = String(calls()[0]?.rawBody)
      expect(raw).toContain(`"file_id":${wire},`)
    }
    for (const bad of ['abc', '9223372036854775808', 1.5, -1, 2 ** 60]) {
      const { ctx } = fakeContext([])
      await expect(
        voiceClone(ctx, { voice_id: 'MyVoice_123', file_id: bad }, models),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    }
  })
  it('上传响应里超过 2^53 的 file_id 按原值保留，再作为整数提交', async () => {
    const big = '9007199254740993'
    const upload = new Response(`{"base_resp":{"status_code":0},"file":{"file_id":${big}}}`, {
      status: 200,
    })
    const { ctx } = fakeContext([upload])
    expect((await uploadFile(ctx, { asset_id: 'a1', purpose: 'voice_clone' })).fileId).toBe(big)
    const clone = fakeContext([{ base_resp: { status_code: 0 } }])
    await voiceClone(clone.ctx, { voice_id: 'MyVoice_123', file_id: big }, models)
    expect(String(clone.calls()[0]?.rawBody)).toContain(`"file_id":${big},`)
  })
  it('voiceDesign validates inputs and refuses a missing voice_id', async () => {
    const a = fakeContext([])
    await expect(voiceDesign(a.ctx, { prompt: ' ', preview_text: 'y' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    const b = fakeContext([{ base_resp: { status_code: 0 } }])
    await expect(
      voiceDesign(b.ctx, { voice_id: 'v', prompt: 'x', preview_text: 'y' }),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})

describe('listVideoTasks / assetDataUrl / dispatch', () => {
  it('listVideoTasks builds the query and returns the payload', async () => {
    const f = fixture('list-tasks')
    const { ctx, calls } = fakeContext([f.response.body])
    await listVideoTasks(ctx, {})
    expect(calls()[0]?.url).toBe(f.request.url)
    const bad = fakeContext([])
    await expect(listVideoTasks(bad.ctx, { page_size: 200 })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('assetDataUrl encodes an asset', async () => {
    const { ctx } = fakeContext([], { mime: 'audio/wav' })
    expect(await assetDataUrl(ctx, 'a1')).toBe('data:audio/wav;base64,AQID')
  })
  it('dispatches every native op and rejects unknown ones', async () => {
    const cases: Array<[string, Record<string, unknown>, Reply[]]> = [
      ['context-ir', { prompt: '一只猫在海边' }, [fixture('context-ir').response.body]],
      ['video-2k-rerender', { source_task_id: 'task-1' }, [fixture('rerender').response.body]],
      [
        'voice-design',
        { voice_id: 'DesignVoice_1', prompt: 'p', preview_text: 't' },
        [fixture('voice-design').response.body],
      ],
      ['upload-file', { asset_id: 'a1' }, [fixture('upload').response.body]],
      ['list-video-tasks', {}, [fixture('list-tasks').response.body]],
      ['raw-request', { path: '/v1/models', method: 'GET' }, [{ base_resp: { status_code: 0 } }]],
    ]
    for (const [op, params, replies] of cases) {
      const { ctx } = fakeContext(replies)
      await expect(runMinimaxNative(op, params, ctx, models)).resolves.toBeDefined()
    }
    const unknown = fakeContext([])
    await expect(runMinimaxNative('nope', {}, unknown.ctx, models)).rejects.toBeInstanceOf(
      ProviderError,
    )
    await expect(
      runMinimaxNative('raw-request', { path: 'models' }, unknown.ctx, models),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
