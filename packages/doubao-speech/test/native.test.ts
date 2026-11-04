import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  audioData,
  buildPodcastRequest,
  consoleManagement,
  DOUBAO_NATIVE_OPERATIONS,
  hotwordTable,
  INTERPRETATION_ENDPOINT,
  meetingNotes,
  nativeOperationSchemas,
  parsePodcastSse,
  podcast,
  runDoubaoNative,
  simultaneousInterpretation,
  translation,
  voiceCloneOp,
  voiceDesignOp,
  voiceQueryOp,
} from '../src/native'
import { fakeContext, fixture, fixtureReply, type Reply } from './helpers'

describe('native declarations', () => {
  it('declares a schema for every exposed operation', () => {
    expect(Object.keys(nativeOperationSchemas).sort()).toEqual([...DOUBAO_NATIVE_OPERATIONS].sort())
    expect(DOUBAO_NATIVE_OPERATIONS).toContain('podcast')
    expect(DOUBAO_NATIVE_OPERATIONS).toContain('simultaneous-interpretation')
  })
})

describe('podcast (required native op)', () => {
  it('builds the recorded request', () => {
    const f = fixture('podcast-sse')
    expect(buildPodcastRequest({ input_text: '两位主持人讨论模型迁移。' })).toEqual(f.request.body)
  })
  it('parses SSE events', () => {
    const events = parsePodcastSse(fixture('podcast-sse').response.text!)
    expect(events).toEqual([
      { event: 1, data: { round_id: 1 } },
      { event: 2, data: { data: 'AQID' } },
    ])
  })
  it('ignores comments and rejects a non-numeric event', () => {
    expect(parsePodcastSse(': keepalive\n\nevent: 5\ndata: {}\n\n')).toEqual([
      { event: 5, data: {} },
    ])
    expect(() => parsePodcastSse('event: x\ndata: {}\n\n')).toThrow(ProviderError)
  })
  it('posts the request and returns parsed events', async () => {
    const f = fixture('podcast-sse')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    const result = await podcast(ctx, { input_text: '两位主持人讨论模型迁移。' })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.events as unknown[]).toHaveLength(2)
  })
  it('validates action, nlp_texts, audio_config, speakers and retry_info', () => {
    expect(() => buildPodcastRequest({ action: 9 })).toThrow(ProviderError)
    expect(() => buildPodcastRequest({ action: 0 })).toThrow(ProviderError)
    expect(() => buildPodcastRequest({ action: 4 })).toThrow(ProviderError)
    expect(() => buildPodcastRequest({ action: 3, nlp_texts: [] })).toThrow(ProviderError)
    expect(() =>
      buildPodcastRequest({ action: 3, nlp_texts: [{ speaker: 'a', text: 'x'.repeat(301) }] }),
    ).toThrow(ProviderError)
    expect(() =>
      buildPodcastRequest({ input_text: 'x', audio_config: { format: 'flac' } }),
    ).toThrow(ProviderError)
    expect(() =>
      buildPodcastRequest({ input_text: 'x', speaker_info: { speakers: ['a'] } }),
    ).toThrow(ProviderError)
    expect(() =>
      buildPodcastRequest({ input_text: 'x', retry_info: { retry_task_id: 'x' } }),
    ).toThrow(ProviderError)
    const built = buildPodcastRequest({
      action: 3,
      nlp_texts: [
        { speaker: 'a', text: '你好' },
        { speaker: 'b', text: '世界' },
      ],
    })
    expect(built.action).toBe(3)
  })
})

describe('simultaneous-interpretation (required native stub)', () => {
  it('returns a validated WSS+protobuf request plan', () => {
    const plan = simultaneousInterpretation({ source_language: 'zh', target_language: 'en' })
    expect(plan).toMatchObject({
      ok: false,
      requires: 'wss+protobuf',
      endpoint: INTERPRETATION_ENDPOINT,
      request: { event: 'StartSession' },
    })
  })
  it('validates mode and languages', () => {
    expect(() =>
      simultaneousInterpretation({ mode: 'x', source_language: 'zh', target_language: 'en' }),
    ).toThrow(ProviderError)
    expect(() =>
      simultaneousInterpretation({ source_language: '', target_language: 'en' }),
    ).toThrow(ProviderError)
  })
})

describe('translation / meeting-notes / hotword-table / console', () => {
  it('translation posts the recorded body', async () => {
    const f = fixture('translation')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await translation(ctx, { text_list: ['你好'], target_language: 'en' })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
  })
  it('translation validates text_list', async () => {
    const { ctx } = fakeContext([])
    await expect(translation(ctx, { text_list: [], target_language: 'en' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      translation(ctx, { text_list: Array.from({ length: 17 }, () => 'x'), target_language: 'en' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('meetingNotes submit and query', async () => {
    const submit = fixture('minutes-submit')
    const a = fakeContext([fixtureReply(submit)])
    await meetingNotes(a.ctx, { action: 'submit', request: submit.request.body })
    expect(a.calls()[0]?.url).toBe(submit.request.url)
    expect(a.calls()[0]?.body).toEqual(submit.request.body)
    expect(a.calls()[0]?.headers).toMatchObject({ 'X-Api-Sequence': '-1' })
    const query = fixture('minutes-query')
    const b = fakeContext([fixtureReply(query)])
    await meetingNotes(b.ctx, { action: 'query', task_id: 'minutes-1' })
    expect(b.calls()[0]?.body).toEqual(query.request.body)
    const c = fakeContext([])
    await expect(meetingNotes(c.ctx, { action: 'query' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(meetingNotes(c.ctx, { action: 'bad' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('hotwordTable posts to the proxy invoke endpoint', async () => {
    const f = fixture('hotword-table')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await hotwordTable(ctx, { action: 'ListBoostingTable', parameters: { page: 1 } })
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    const bad = fakeContext([])
    await expect(hotwordTable(bad.ctx, { action: 'Unknown' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('consoleManagement is a validated signing stub', () => {
    expect(consoleManagement({ action: 'ListVoices' })).toMatchObject({
      ok: false,
      requires: 'signed-console-request',
    })
    expect(() => consoleManagement({})).toThrow(ProviderError)
  })
})

describe('voice clone / design / query', () => {
  it('audioData accepts inline base64, data URIs and assets', async () => {
    const a = fakeContext().ctx
    expect(await audioData(a, { audio_data: 'AQID' })).toEqual({ data: 'AQID', format: 'wav' })
    expect(await audioData(a, { audio_data: 'data:audio/wav;base64,AQID' })).toEqual({
      data: 'AQID',
      format: 'wav',
    })
    const b = fakeContext([], { mime: 'audio/mpeg' })
    expect(await audioData(b.ctx, { audio_asset_id: 'a1', format: 'mp3' })).toEqual({
      data: 'AQID',
      format: 'mp3',
    })
    await expect(audioData(a, {})).rejects.toMatchObject({ code: 'invalid_input' })
    const c = fakeContext([])
    c.ctx.assets = undefined
    await expect(audioData(c.ctx, { audio_asset_id: 'a1' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
  it('voiceCloneOp posts the recorded body', async () => {
    const f = fixture('voice-clone')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await voiceCloneOp(ctx, { speaker_id: 'S_test123', audio_data: 'AQID', format: 'wav' })
    expect(calls()[0]?.body).toEqual(f.request.body)
  })
  it('voiceCloneOp validates the slot and demo_text', async () => {
    const { ctx } = fakeContext([])
    await expect(
      voiceCloneOp(ctx, { speaker_id: 'bad', audio_data: 'AQID' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      voiceCloneOp(ctx, { speaker_id: 'S_x', audio_data: 'AQID', demo_text: 'a' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('voiceDesignOp posts the recorded body', async () => {
    const f = fixture('voice-design')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await voiceDesignOp(ctx, {
      speaker_id: 'S_test123',
      text: '你好，欢迎收听今天的节目。',
      prompt: '温暖的女声',
    })
    expect(calls()[0]?.body).toEqual(f.request.body)
    const bad = fakeContext([])
    await expect(
      voiceDesignOp(bad.ctx, { speaker_id: 'S_x', text: '', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('voiceQueryOp posts the recorded body', async () => {
    const f = fixture('get-voice')
    const { ctx, calls } = fakeContext([fixtureReply(f)])
    await voiceQueryOp(ctx, { speaker_id: 'S_test123' })
    expect(calls()[0]?.body).toEqual(f.request.body)
    const bad = fakeContext([])
    await expect(voiceQueryOp(bad.ctx, {})).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('runDoubaoNative dispatch', () => {
  it('dispatches every native op', async () => {
    const cases: Array<[string, Record<string, unknown>, Reply[]]> = [
      [
        'podcast',
        { input_text: '两位主持人讨论模型迁移。' },
        [fixtureReply(fixture('podcast-sse'))],
      ],
      ['simultaneous-interpretation', { source_language: 'zh', target_language: 'en' }, []],
      [
        'translation',
        { text_list: ['你好'], target_language: 'en' },
        [fixtureReply(fixture('translation'))],
      ],
      [
        'meeting-notes',
        { action: 'query', task_id: 'minutes-1' },
        [fixtureReply(fixture('minutes-query'))],
      ],
      ['hotword-table', { action: 'ListBoostingTable' }, [fixtureReply(fixture('hotword-table'))]],
      ['console-management', { action: 'ListVoices' }, []],
      [
        'voice-clone',
        { speaker_id: 'S_x', audio_data: 'AQID' },
        [fixtureReply(fixture('voice-clone'))],
      ],
      [
        'voice-design',
        { speaker_id: 'S_x', text: 'abcdefghijklmnop', prompt: 'p' },
        [fixtureReply(fixture('voice-design'))],
      ],
      ['voice-query', { speaker_id: 'S_x' }, [fixtureReply(fixture('get-voice'))]],
      ['raw-request', { path: '/api/v3/tts/query', body: { task_id: 'x' } }, [{ code: 0 }]],
    ]
    for (const [op, params, replies] of cases) {
      const { ctx } = fakeContext(replies)
      await expect(runDoubaoNative(op, params, ctx)).resolves.toBeDefined()
    }
  })
  it('rejects unknown ops and invalid raw paths', async () => {
    const { ctx } = fakeContext([])
    await expect(runDoubaoNative('nope', {}, ctx)).rejects.toBeInstanceOf(ProviderError)
    await expect(runDoubaoNative('raw-request', { path: 'x' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
