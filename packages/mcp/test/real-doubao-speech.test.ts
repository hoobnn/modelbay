/**
 * MCP → 真实豆包语音适配器（Node 版，注入 fetch，不联网）。
 * 断言每个声明的 MCP 参数都落到了上游请求里，重路由的工具走到对应的 native 操作。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterContext, readSecrets } from '@modelbay/core'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { loadAdapter } from '../src/launch'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

interface Captured {
  url: string
  // 测试里按路径取嵌套字段，不逐层声明类型
  // oxlint-disable-next-line typescript/no-explicit-any
  body: Record<string, any>
  headers: Record<string, string>
}

async function setup(reply: (url: string) => Response = () => new Response('{}')) {
  const platform = platformOf('doubao-speech')
  const adapter = (await loadAdapter(platform))!
  const captured: Captured[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    captured.push({
      url: String(url),
      body,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    return reply(String(url))
  }) as typeof fetch
  const set = generateTools(platform, { adapter })
  const handlers = createHandlers({
    set,
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, {
        DOUBAO_API_KEY: 'k',
        VOLC_ACCESS_KEY_ID: 'ak',
        VOLC_SECRET_ACCESS_KEY: 'sk',
      }),
      fetchImpl,
      assets: createMcpAssetSource({ fetchImpl }),
    }),
    groups: MCP_TOOL_GROUPS.all,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    serverInfo: { name: 'test', version: '0.0.0' },
  })
  return { handlers, captured, set }
}

const dir = mkdtempSync(join(tmpdir(), 'modelbay-doubao-'))
const wav = join(dir, 'a.wav')
writeFileSync(wav, Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]))

const audioStream = () =>
  new Response('{"code":0,"data":"AAA=","audio":"AAA="}\n{"code":20000000,"message":"ok"}', {
    headers: { 'X-Api-Status-Code': '20000000' },
  })

describe('工具目录', () => {
  it('没有适配器未实现的工具', async () => {
    const { set } = await setup()
    const names = set.all.map((tool) => tool.name)
    for (const gone of [
      'open_realtime_session',
      'send_realtime_event',
      'receive_realtime_events',
      'close_realtime_session',
      'upgrade_voice',
      'get_voice',
      'get_job',
      'recover_job',
      'list_jobs',
    ])
      expect(names).not.toContain(gone)
  })

  it('每个 native 工具的操作名适配器都实现了', async () => {
    const platform = platformOf('doubao-speech')
    const adapter = (await loadAdapter(platform))!
    const { set } = await setup()
    for (const tool of set.all)
      if (tool.route.kind === 'native') expect(adapter.nativeOperations).toContain(tool.route.op)
  })
})

describe('text_to_speech', () => {
  it('speech_rate / loudness_rate 整数直通，pitch / language / instructions 进 additions', async () => {
    const { handlers, captured } = await setup(audioStream)
    const result = await handlers.callTool('text_to_speech', {
      text: '你好',
      voice: 'zh_female_vv_uranus_bigtts',
      speech_rate: 30,
      loudness_rate: -10,
      pitch: 3,
      language: 'zh-cn',
      instructions: '开心一点',
      format: 'wav',
      sample_rate: 16000,
    })
    expect(result.isError).toBeFalsy()
    const req = captured[0]!.body.req_params
    expect(captured[0]!.url).toContain('/api/v3/tts/unidirectional')
    expect(req.audio_params).toEqual({
      format: 'pcm',
      sample_rate: 16000,
      speech_rate: 30,
      loudness_rate: -10,
    })
    expect(JSON.parse(req.additions)).toEqual({
      context_texts: ['开心一点'],
      explicit_language: 'zh-cn',
      post_process: { pitch: 3 },
    })
  })

  it('不给时 speech_rate 为 0，additions 为空对象', async () => {
    const { handlers, captured } = await setup(audioStream)
    await handlers.callTool('text_to_speech', { text: '你好' })
    const req = captured[0]!.body.req_params
    expect(req.audio_params).toEqual({ format: 'mp3', sample_rate: 24000, speech_rate: 0 })
    expect(req.additions).toBe('{}')
  })

  it('归一化 speed 仍按 0.5–2 换算（SDK 行为不变）', async () => {
    const { handlers, captured } = await setup(audioStream)
    await handlers.callTool('text_to_speech', { text: '你好', speed: 1.5 })
    expect(captured[0]!.body.req_params.audio_params.speech_rate).toBe(50)
  })
})

describe('generate_audio', () => {
  it('format / sample_rate 进 audio_config', async () => {
    const { handlers, captured } = await setup(audioStream)
    await handlers.callTool('generate_audio', { prompt: '雨声', format: 'wav', sample_rate: 48000 })
    expect(captured[0]!.url).toContain('/api/v3/tts/create')
    expect(captured[0]!.body.audio_config).toEqual({ format: 'wav', sample_rate: 48000 })
    expect(captured[0]!.body.text_prompt).toContain('雨声')
  })
})

describe('speech_to_text', () => {
  const ok = () => Response.json({ result: { text: '你好', utterances: [] } })

  it('itn / punc / ddc / utterances / language / hotwords', async () => {
    const { handlers, captured } = await setup(ok)
    const result = await handlers.callTool('speech_to_text', {
      audio: wav,
      language: 'zh-CN',
      itn: false,
      punc: false,
      ddc: true,
      utterances: false,
      hotwords: ['火山', '豆包'],
    })
    expect(result.isError).toBeFalsy()
    const body = captured[0]!.body
    expect(body.audio.language).toBe('zh-CN')
    expect(body.request).toMatchObject({
      enable_itn: false,
      enable_punc: false,
      enable_ddc: true,
      show_utterances: false,
    })
    expect(JSON.parse(body.request.corpus.context)).toEqual({
      hotwords: [{ word: '火山' }, { word: '豆包' }],
    })
  })

  it('context 变成对话上下文；与 hotwords 同给时拒绝', async () => {
    const { handlers, captured } = await setup(ok)
    await handlers.callTool('speech_to_text', { audio: wav, context: '会议讨论预算' })
    expect(JSON.parse(captured[0]!.body.request.corpus.context)).toEqual({
      context_type: 'dialog_ctx',
      context_data: [{ text: '会议讨论预算' }],
    })
    await expect(
      handlers.callTool('speech_to_text', { audio: wav, context: 'x', hotwords: ['y'] }),
    ).rejects.toThrow('只能二选一')
  })

  it('不给开关时沿用 SDK 默认', async () => {
    const { handlers, captured } = await setup(ok)
    await handlers.callTool('speech_to_text', { audio: wav })
    expect(captured[0]!.body.request).toEqual({
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
    })
  })
})

describe('声音复刻 / 设计 / 查询走 native', () => {
  const voiceReply = () => Response.json({ status: 1 })

  it('clone_voice', async () => {
    const { handlers, captured } = await setup(voiceReply)
    const result = await handlers.callTool('clone_voice', {
      speaker_id: 'S_abc123',
      audio_file: wav,
      language: 'en',
      demo_text: '你好世界啊',
    })
    expect(result.isError).toBeFalsy()
    expect(captured[0]!.url).toContain('/api/v3/tts/voice_clone')
    expect(captured[0]!.body).toMatchObject({
      speaker_id: 'S_abc123',
      language: 1,
      audio: { format: 'wav' },
      extra_params: { demo_text: '你好世界啊' },
    })
    expect(captured[0]!.body.audio.data).toBeTruthy()
  })

  it('design_voice', async () => {
    const { handlers, captured } = await setup(voiceReply)
    await handlers.callTool('design_voice', {
      speaker_id: 'S_abc123',
      preview_text: '大家好',
      description: '低沉温和的男声',
    })
    expect(captured[0]!.url).toContain('/api/v3/tts/voice_design')
    expect(captured[0]!.body).toMatchObject({
      speaker_id: 'S_abc123',
      text: '大家好',
      prompt: { text_prompt: '低沉温和的男声' },
    })
  })

  it('query_voice', async () => {
    const { handlers, captured } = await setup(voiceReply)
    await handlers.callTool('query_voice', { speaker_id: 'S_abc123' })
    expect(captured[0]!.url).toContain('/api/v3/tts/get_voice')
    expect(captured[0]!.body).toEqual({ speaker_id: 'S_abc123' })
  })
})

describe('generate_podcast', () => {
  const sse = () => new Response('')

  it('text / url / topic / dialogue 各对应官方字段', async () => {
    const { handlers, captured } = await setup(sse)
    await handlers.callTool('generate_podcast', {
      text: '一篇文章',
      speakers: ['a', 'b'],
      format: 'aac',
      script_only: true,
    })
    expect(captured[0]!.body).toMatchObject({
      action: 0,
      input_text: '一篇文章',
      input_info: { only_nlp_text: true },
      speaker_info: { speakers: ['a', 'b'] },
      audio_config: { format: 'aac' },
    })
    await handlers.callTool('generate_podcast', { url: 'https://example.com/a.pdf' })
    expect(captured[1]!.body.input_info).toEqual({ input_url: 'https://example.com/a.pdf' })
    await handlers.callTool('generate_podcast', { topic: '量子计算' })
    expect(captured[2]!.body).toMatchObject({ action: 4, prompt_text: '量子计算' })
    await handlers.callTool('generate_podcast', {
      dialogue: [{ speaker: 'a', text: '你好' }],
    })
    expect(captured[3]!.body).toMatchObject({
      action: 3,
      nlp_texts: [{ speaker: 'a', text: '你好' }],
    })
  })

  it('parameters 深度合并；输入不是四选一时拒绝', async () => {
    const { handlers, captured } = await setup(sse)
    await handlers.callTool('generate_podcast', {
      text: 'x',
      parameters: { input_info: { input_text_max_length: 5000 }, use_head_music: false },
    })
    expect(captured[0]!.body.input_info).toEqual({ input_text_max_length: 5000 })
    expect(captured[0]!.body.use_head_music).toBe(false)
    await expect(
      handlers.callTool('generate_podcast', { text: 'x', url: 'https://a.b' }),
    ).rejects.toThrow('四选一')
  })
})

describe('translate_text', () => {
  it('texts → text_list，术语表进 corpus', async () => {
    const { handlers, captured } = await setup(() => Response.json({ code: 20000000 }))
    await handlers.callTool('translate_text', {
      texts: ['火山引擎', '你好'],
      target_language: 'en',
      source_language: 'zh',
      glossary: { 火山引擎: 'Volcengine' },
      glossary_table_id: 'tbl-1',
    })
    expect(captured[0]!.url).toContain('/api/v3/machine_translation/matx_translate')
    expect(captured[0]!.body).toEqual({
      text_list: ['火山引擎', '你好'],
      target_language: 'en',
      source_language: 'zh',
      corpus: { glossary_list: { 火山引擎: 'Volcengine' }, glossary_table_id: 'tbl-1' },
    })
  })
})

describe('summarize_meeting', () => {
  it('提交：参数换算成官方 Input / Params', async () => {
    const { handlers, captured } = await setup(() => Response.json({ Data: { TaskID: 't1' } }))
    await handlers.callTool('summarize_meeting', {
      file_url: 'https://example.com/a.mp3',
      language: 'en_us',
      chapters: true,
      todos: true,
      qa: true,
      translate_to: 'zh_cn',
      speaker_count: 3,
      hotwords: ['Volcengine'],
      word_timestamps: true,
      bundle_billing: true,
    })
    expect(captured[0]!.url).toContain('/api/v3/auc/lark/submit')
    expect(captured[0]!.body).toEqual({
      Input: { Offline: { FileURL: 'https://example.com/a.mp3', FileType: 'audio' } },
      Params: {
        AllActivate: true,
        SourceLang: 'en_us',
        AudioTranscriptionEnable: true,
        AudioTranscriptionParams: {
          SpeakerIdentification: true,
          NumberOfSpeaker: 3,
          HotWords: '[{"word":"Volcengine"}]',
          NeedWordTimeSeries: true,
        },
        TranslationEnable: true,
        TranslationParams: { TargetLang: 'zh_cn' },
        InformationExtractionEnabled: true,
        InformationExtractionParams: { Types: ['todo_list', 'question_answer'] },
        SummarizationEnabled: true,
        SummarizationParams: { Types: ['summary'] },
        ChapterEnabled: true,
      },
    })
  })

  it('task_id 走查询，X-Api-Request-Id 取 TaskID', async () => {
    const { handlers, captured } = await setup(() => Response.json({ Data: { Status: 'running' } }))
    await handlers.callTool('summarize_meeting', { task_id: 'task-9' })
    expect(captured[0]!.url).toContain('/api/v3/auc/lark/query')
    expect(captured[0]!.body).toEqual({ TaskID: 'task-9' })
    expect(captured[0]!.headers['x-api-request-id']).toBe('task-9')
  })

  it('一项附加功能都没开时拒绝', async () => {
    const { handlers } = await setup()
    await expect(
      handlers.callTool('summarize_meeting', {
        file_url: 'https://example.com/a.mp3',
        summary: false,
      }),
    ).rejects.toThrow('至少开启')
  })
})

describe('管理类工具', () => {
  it('manage_word_table：action 进查询串，content 进请求体', async () => {
    const { handlers, captured } = await setup(() => Response.json({}))
    await handlers.callTool('manage_word_table', {
      action: 'CreateBoostingTable',
      parameters: { BoostingTableName: 't' },
      content: '火山\n豆包',
    })
    expect(captured[0]!.url).toContain('Action=CreateBoostingTable')
    expect(captured[0]!.body).toEqual({ BoostingTableName: 't', content: '火山\n豆包' })
  })

  it('speech_console：action 进签名请求', async () => {
    const { handlers, captured } = await setup(() => Response.json({}))
    await handlers.callTool('speech_console', { action: 'ListSpeakers', parameters: {} })
    expect(captured[0]!.url).toContain('Action=ListSpeakers')
    expect(captured[0]!.url).toContain('Version=2025-05-20')
  })

  it('speech_raw_request product=http：request 为请求体，resource_id 为资源头', async () => {
    const { handlers, captured } = await setup(() => Response.json({}))
    await handlers.callTool('speech_raw_request', {
      product: 'http',
      path: '/api/v3/tts/get_voice',
      request: { speaker_id: 'S_x' },
      resource_id: 'seed-icl-2.0',
    })
    expect(captured[0]!.url).toContain('/api/v3/tts/get_voice')
    expect(captured[0]!.body).toEqual({ speaker_id: 'S_x' })
    expect(captured[0]!.headers['x-api-resource-id']).toBe('seed-icl-2.0')
  })
})
