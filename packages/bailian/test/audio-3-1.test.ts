import { describe, expect, it } from 'vite-plus/test'
import { createBailianAdapter } from '../src/adapter'
import { all as bailianModels } from '../src/models/index'
import { fakeContext, fixture } from './helpers'

const adapter = createBailianAdapter(bailianModels)
const native = (
  op: string,
  params: Record<string, unknown>,
  ctx: ReturnType<typeof fakeContext>['ctx'],
) => adapter.native!(op, params, ctx)

/** 2026-11-11 实测响应（qwen-audio-3.1-asr-flash 原生接口），只留解析要用的字段。 */
const asrReply = {
  output: {
    text: '今天的会议讨论了升级计划。',
    sentence: { begin_time: 160, end_time: 5800, text: '今天的会议讨论了升级计划。' },
    output: { text: '今天的会议讨论了升级计划。' },
  },
  usage: { duration: 6, input_tokens: 75, output_tokens: 14, total_tokens: 89 },
  request_id: 'r1',
}

describe('Qwen-Audio-ASR 3.1 同步识别', () => {
  it('走原生接口：format 从 URL 推断，上下文放在音频前，language 写进 language_hints', async () => {
    const { ctx, calls, body } = fakeContext([asrReply])
    const result = (await native(
      'asr',
      {
        audio: 'https://example.com/a.wav',
        model: 'qwen-audio-3.1-asr-flash',
        context: 'Kubernetes',
        language: 'zh',
        itn: false,
      },
      ctx,
    )) as { text: string; sentences: unknown[] }
    expect(calls()[0]!.url).toContain('/api/v1/services/aigc/multimodal-generation/generation')
    expect(body(0)).toEqual({
      model: 'qwen-audio-3.1-asr-flash',
      input: {
        messages: [
          { role: 'user', content: [{ type: 'input_text', text: 'Kubernetes' }] },
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: 'https://example.com/a.wav' } }],
          },
        ],
      },
      parameters: { language_hints: ['zh'], format: 'wav' },
    })
    expect(result.text).toBe('今天的会议讨论了升级计划。')
    expect(result.sentences).toHaveLength(1)
  })

  it('推不出格式、要 itn 时直接报错', async () => {
    await expect(
      native(
        'asr',
        { audio: 'https://example.com/a', model: 'qwen-audio-3.1-asr-flash' },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('format') })
    await expect(
      native(
        'asr',
        { audio: 'https://example.com/a.wav', model: 'qwen-audio-3.1-asr-flash', itn: true },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('itn') })
  })

  it('文件转写模型不能走同步识别', async () => {
    await expect(
      native(
        'asr',
        { audio: 'https://example.com/a.wav', model: 'qwen-audio-3.1-asr-flash-filetrans' },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('asr-filetrans') })
  })
})

describe('录音文件转写', () => {
  it('提交异步任务：file_urls 只放一个，parameters 至少是空对象', async () => {
    const { ctx, calls, body } = fakeContext([{ output: { task_id: 't1' }, request_id: 'r' }])
    const result = await native('asr-filetrans', { audio: 'https://example.com/a.wav' }, ctx)
    expect(result).toEqual({ job_id: 't1', task_id: 't1', request_id: 'r' })
    expect(calls()[0]!.url).toContain('/api/v1/services/audio/asr/transcription')
    expect(calls()[0]!.headers).toMatchObject({ 'X-DashScope-Async': 'enable' })
    expect(body(0)).toEqual({
      model: 'qwen-audio-3.1-asr-flash-filetrans',
      input: { file_urls: ['https://example.com/a.wav'] },
      parameters: {},
    })
  })

  it('本地文件先上传成 oss://，并带上 OSS 解析头；说话人分离写进 parameters', async () => {
    const { ctx, calls, body } = fakeContext(
      [
        fixture('upload-policy').response.body,
        new Response('', { status: 200 }),
        { output: { task_id: 't2' } },
      ],
      { mime: 'audio/wav' },
    )
    await native(
      'asr-filetrans',
      {
        audio: { assetId: 'a', kind: 'audio' },
        diarization: true,
        speaker_count: 2,
        language: 'zh',
      },
      ctx,
    )
    expect(body(2).input.file_urls[0]).toMatch(/^oss:\/\//)
    expect(body(2).parameters).toEqual({
      language_hints: ['zh'],
      diarization_enabled: true,
      speaker_count: 2,
    })
    expect(calls()[2]!.headers).toMatchObject({ 'X-DashScope-OssResourceResolve': 'enable' })
  })

  it('speaker_count 按声明的范围校验，越界时不上传也不提交', async () => {
    const { ctx, fetch } = fakeContext([], { mime: 'audio/wav' })
    await expect(
      native('asr-filetrans', { audio: { assetId: 'a', kind: 'audio' }, speaker_count: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('拒绝 Data URI', async () => {
    await expect(
      native('asr-filetrans', { audio: 'data:audio/wav;base64,AAAA' }, fakeContext([]).ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('poll 读 transcription_url，返回全文和以秒为单位的句子', async () => {
    const transcription = {
      transcripts: [
        {
          channel_id: 0,
          text: '第一句。第二句。',
          sentences: [
            { begin_time: 160, end_time: 1800, text: '第一句。', speaker_id: 0 },
            { begin_time: 1800, end_time: 3200, text: '第二句。', speaker_id: 1 },
          ],
        },
      ],
    }
    const { ctx, calls } = fakeContext([
      {
        output: {
          task_status: 'SUCCEEDED',
          results: [
            {
              file_url: 'https://example.com/a.wav',
              transcription_url: 'https://result.example.com/t.json',
              subtask_status: 'SUCCEEDED',
            },
          ],
        },
        usage: { duration: 3 },
      },
      transcription,
    ])
    const result = await adapter.poll!('t1', ctx)
    expect(calls()[1]!.url).toBe('https://result.example.com/t.json')
    expect(result).toMatchObject({
      state: 'succeeded',
      outputs: [
        { type: 'text', text: '第一句。第二句。' },
        {
          type: 'json',
          value: {
            segments: [
              { start: 0.16, end: 1.8, text: '第一句。', channel: 0, speaker: 0 },
              { start: 1.8, end: 3.2, text: '第二句。', channel: 0, speaker: 1 },
            ],
          },
        },
      ],
    })
  })

  it('子任务全部失败时任务算失败', async () => {
    const { ctx } = fakeContext([
      {
        output: {
          task_status: 'SUCCEEDED',
          results: [
            { subtask_status: 'FAILED', code: 'InvalidFile.DownloadFailed', message: 'bad' },
          ],
        },
      },
    ])
    const result = await adapter.poll!('t1', ctx)
    expect(result.state).toBe('failed')
  })
})

describe('音频生成（qwen-audio-3.1-tts-next）', () => {
  it('参考音频 URL 与 Data URI 分别放 audio_url / audio_data，返回可下载的文件', async () => {
    const { ctx, calls, body } = fakeContext([
      {
        output: {
          audio: { url: 'http://dashscope-result-bj.example.com/a.mp3', duration: 4.4 },
          finish_reason: 'stop',
        },
        usage: { total_tokens: 10 },
        request_id: 'r',
      },
    ])
    const result = (await native(
      'audio-generation',
      {
        prompt: '@voice1 说：你好',
        references: ['https://example.com/v.wav', 'data:audio/wav;base64,AAAA'],
        format: 'mp3',
        rate: 1.2,
      },
      ctx,
    )) as { outputs: unknown[] }
    expect(calls()[0]!.url).toContain('/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(body(0)).toEqual({
      model: 'qwen-audio-3.1-tts-next',
      input: {
        text_prompt: '@voice1 说：你好',
        references: [
          { audio_url: 'https://example.com/v.wav' },
          { audio_data: 'data:audio/wav;base64,AAAA' },
        ],
        format: 'mp3',
        rate: 1.2,
      },
    })
    expect(result.outputs).toEqual([
      {
        type: 'file',
        kind: 'audio',
        mime: 'audio/mpeg',
        url: 'https://dashscope-result-bj.example.com/a.mp3',
        name: 'audio-generation.mp3',
      },
    ])
  })

  it('format 写在 parameters 里时输出文件也按它命名；参考音频可由 files.read 读取', async () => {
    const { ctx, body } = fakeContext(
      [{ output: { audio: { url: 'https://example.com/a.pcm' } } }],
      { mime: 'audio/wav', files: {} },
    )
    const result = (await native(
      'audio-generation',
      { prompt: 'x', references: [{ assetId: 'v', kind: 'audio' }], parameters: { format: 'pcm' } },
      ctx,
    )) as { outputs: Array<{ mime: string; name: string }> }
    expect(body(0).input.references[0].audio_data).toMatch(/^data:audio\/wav;base64,/)
    expect(ctx.files!.read).toHaveBeenCalled()
    expect(ctx.assets!.load).not.toHaveBeenCalled()
    expect(result.outputs[0]).toMatchObject({ mime: 'audio/pcm', name: 'audio-generation.pcm' })
  })

  it('按声明挡住超量参考、越界参数和未知参数', async () => {
    const refs = Array.from({ length: 4 }, () => 'https://example.com/v.wav')
    for (const params of [
      { prompt: 'x', references: refs },
      { prompt: 'x', rate: 3 },
      { prompt: 'x', voice: 'Cherry' },
      { prompt: 'x'.repeat(3001) },
    ])
      await expect(native('audio-generation', params, fakeContext([]).ctx)).rejects.toMatchObject({
        code: 'invalid_input',
      })
  })

  it('不能当 audio.speech 模型用', async () => {
    await expect(
      adapter.submit(
        {
          capability: 'audio.speech',
          model: 'qwen-audio-3.1-tts-next',
          input: { text: '你好', voice: 'Cherry' },
        },
        fakeContext([]).ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('多模态重排序', () => {
  it('query / documents 可以是 text / image / video 对象，混用时字符串包成 {text}', async () => {
    const { ctx, body } = fakeContext([{ output: { results: [] } }])
    await native(
      'rerank',
      {
        model: 'qwen3-vl-rerank',
        query: { text: '猫' },
        documents: [
          '一只狗',
          { image: 'https://example.com/c.png' },
          { video: 'https://example.com/v.mp4' },
        ],
        instruct: 'Find cats',
        fps: 0.5,
      },
      ctx,
    )
    expect(body(0)).toEqual({
      model: 'qwen3-vl-rerank',
      input: {
        query: { text: '猫' },
        documents: [
          { text: '一只狗' },
          { image: 'https://example.com/c.png' },
          { video: 'https://example.com/v.mp4' },
        ],
      },
      parameters: { return_documents: false, instruct: 'Find cats', fps: 0.5 },
    })
  })

  it('挡住多键对象、query 里的视频和非公网视频', async () => {
    for (const params of [
      { query: '猫', documents: [{ text: 'a', image: 'b' }] },
      { query: { video: 'https://example.com/v.mp4' }, documents: ['a'] },
      { query: '猫', documents: [{ video: 'data:video/mp4;base64,AAAA' }] },
    ])
      await expect(native('rerank', params, fakeContext([]).ctx)).rejects.toMatchObject({
        code: 'invalid_input',
      })
  })
})

describe('重排序的模型专属参数', () => {
  it('fps 按 qwen3-vl-rerank 声明校验，其他模型传 fps 直接报错', async () => {
    for (const params of [
      { model: 'qwen3-vl-rerank', query: '猫', documents: ['a'], fps: 2 },
      { model: 'qwen3.7-text-rerank', query: '猫', documents: ['a'], fps: 0.5 },
    ])
      await expect(native('rerank', params, fakeContext([]).ctx)).rejects.toMatchObject({
        code: 'invalid_input',
      })
  })
})
