/** 对齐 plein 的 MiniMax 声音复刻 / 音色设计 / 试听用例，以及远端模型列表。 */
import { describe, expect, it, vi } from 'vite-plus/test'
import type { AssetRef } from '@modelbay/core'
import {
  cloneVoice,
  designVoice,
  minimaxAdapter,
  minimaxVoiceClone,
  minimaxVoiceDesign,
} from '../src/index'
import { hostContext } from './helpers'

const sample: AssetRef = { assetId: 'a', kind: 'audio' }
const wav = { mime: 'audio/wav', duration: 20 }

describe('声音复刻', () => {
  it('先 multipart 上传样本，再用 file_id 提交复刻', async () => {
    const { ctx, fetch } = hostContext(
      [
        { file: { file_id: 263891729178625 }, base_resp: { status_code: 0 } },
        { input_sensitive: { type: 0 }, demo_audio: '', base_resp: { status_code: 0 } },
      ],
      { mime: 'audio/mpeg', duration: 30 },
    )
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, ctx)).resolves.toEqual({
      status: 'ready',
    })
    const [uploadUrl, upload] = fetch.mock.calls[0]!
    expect(uploadUrl).toBe('https://api.minimax.cn/v1/files/upload')
    expect(upload!.headers).not.toHaveProperty('Content-Type')
    const form = upload!.body as FormData
    expect(form.get('purpose')).toBe('voice_clone')
    expect((form.get('file') as File).name).toBe('sample.mp3')
    expect(fetch.mock.calls[1]![0]).toBe('https://api.minimax.cn/v1/voice_clone')
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body))).toMatchObject({
      voice_id: 'pleinabcdefgh',
      need_noise_reduction: false,
      need_volume_normalization: false,
    })
  })

  it('样本过短直接拦下，未实名按鉴权失败报', async () => {
    const short = hostContext([], { mime: 'audio/wav', duration: 3 })
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, short.ctx)).rejects.toMatchObject(
      { code: 'invalid_input' },
    )
    expect(short.fetch).not.toHaveBeenCalled()
    const { ctx } = hostContext(
      [
        { file: { file_id: 1 }, base_resp: { status_code: 0 } },
        { base_resp: { status_code: 2038, status_msg: 'no cloning permission' } },
      ],
      wav,
    )
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, ctx)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('增强音频单独上传为 prompt_audio，试听带合成模型，显式传递处理选项', async () => {
    const { ctx, fetch, body } = hostContext(
      [{ file: { file_id: 1 } }, { file: { file_id: 2 } }, { base_resp: { status_code: 0 } }],
      wav,
    )
    vi.mocked(ctx.files!.read)
      .mockResolvedValueOnce({ data: new Uint8Array([1]), mime: 'audio/wav', duration: 20 })
      .mockResolvedValueOnce({ data: new Uint8Array([2]), mime: 'audio/wav', duration: 4 })
    await cloneVoice(
      {
        voiceId: 'pleinabcdefgh',
        sample,
        promptSample: { assetId: 'b', kind: 'audio' },
        promptText: '参考文字',
        previewText: '试听文字',
        noiseReduction: true,
        volumeNormalization: true,
      },
      ctx,
    )
    expect((fetch.mock.calls[1]![1]!.body as FormData).get('purpose')).toBe('prompt_audio')
    expect(body(2)).toMatchObject({
      file_id: 1,
      clone_prompt: { prompt_audio: 2, prompt_text: '参考文字' },
      model: 'speech-2.8-hd',
      text: '试听文字',
      need_noise_reduction: true,
      need_volume_normalization: true,
    })
  })

  it('增强参考达到八秒，提交前拒绝，不产生样本上传', async () => {
    const { ctx, fetch } = hostContext([], wav)
    vi.mocked(ctx.files!.read)
      .mockResolvedValueOnce({ data: new Uint8Array([1]), mime: 'audio/wav', duration: 20 })
      .mockResolvedValueOnce({ data: new Uint8Array([2]), mime: 'audio/wav', duration: 8 })
    await expect(
      cloneVoice(
        {
          voiceId: 'pleinabcdefgh',
          sample,
          promptSample: { assetId: 'b', kind: 'audio' },
          promptText: '文字',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('增强参考与文字必须成对；音色 ID 与格式校验', async () => {
    const { ctx, fetch } = hostContext([], wav)
    for (const input of [
      { voiceId: 'pleinabcdefgh', sample, promptText: '只有文字' },
      { voiceId: 'bad', sample },
    ])
      await expect(cloneVoice(input, ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    const mp4 = hostContext([], { mime: 'video/mp4', duration: 20 })
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, mp4.ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('试听 demo_audio 下载并嗅探格式；下载失败不影响已创建的音色', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0])
    const ok = hostContext(
      [
        { file: { file_id: 1 } },
        { base_resp: { status_code: 0 }, demo_audio: 'https://cdn.minimax.io/demo.mp3' },
        new Response(bytes),
      ],
      wav,
    )
    const result = await cloneVoice({ voiceId: 'pleinabcdefgh', sample }, ok.ctx)
    expect(result).toMatchObject({ status: 'ready', preview: { mime: 'audio/mpeg' } })
    expect([...result.preview!.data]).toEqual([...bytes])
    const failed = hostContext(
      [
        { file: { file_id: 1 } },
        { base_resp: { status_code: 0 }, demo_audio: 'https://cdn.minimax.io/demo.mp3' },
        new Response('nope', { status: 404 }),
      ],
      wav,
    )
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, failed.ctx)).resolves.toEqual({
      status: 'ready',
    })
    expect(failed.ctx.log).toHaveBeenCalled()
  })

  it('只有 ctx.assets（MCP）时回退按 assetId 读取样本', async () => {
    const { ctx } = hostContext([{ file: { file_id: 1 } }, { base_resp: { status_code: 0 } }])
    ctx.files = undefined
    ctx.assets = {
      load: vi.fn(async () => ({ data: new Uint8Array([1, 2]), mime: 'audio/mpeg' })),
    }
    await expect(cloneVoice({ voiceId: 'pleinabcdefgh', sample }, ctx)).resolves.toMatchObject({
      status: 'ready',
    })
    expect(ctx.assets.load).toHaveBeenCalledWith('a')
  })

  it('导出的规格与 plein VoiceCloneSpec / VoiceDesignSpec 形状一致', () => {
    expect(minimaxVoiceClone).toMatchObject({
      voiceId: 'generated',
      promptSample: true,
      previewModel: 'speech-2.8-hd',
      clone: cloneVoice,
    })
    expect(minimaxVoiceDesign).toMatchObject({
      voiceId: 'generated',
      maxPromptLength: 2000,
      maxPreviewLength: 500,
      design: designVoice,
    })
  })
})

describe('音色设计', () => {
  it('无需上传样本，返回平台音色 ID 并解码 hex 试听', async () => {
    const { ctx, fetch, body } = hostContext([
      { voice_id: 'designed123', trial_audio: '010203', base_resp: { status_code: 0 } },
    ])
    const result = await designVoice(
      { voiceId: 'pleinabcdefgh', prompt: '低沉男声', previewText: '这是试听。' },
      ctx,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.minimax.cn/v1/voice_design')
    expect(body()).toEqual({
      voice_id: 'pleinabcdefgh',
      prompt: '低沉男声',
      preview_text: '这是试听。',
    })
    expect(result).toMatchObject({
      status: 'ready',
      voiceId: 'designed123',
      preview: { data: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg' },
    })
  })
  it('拒绝图片、空描述；缺音色 ID 标为结果未知', async () => {
    const { ctx, fetch } = hostContext([{ base_resp: { status_code: 0 } }])
    for (const input of [
      { voiceId: 'v', prompt: 'p', previewText: 't', image: sample },
      { voiceId: 'v', prompt: ' ', previewText: 't' },
      { voiceId: 'v', prompt: 'p', previewText: 'x'.repeat(501) },
    ])
      await expect(designVoice(input, ctx)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).not.toHaveBeenCalled()
    await expect(
      designVoice({ voiceId: 'v', prompt: 'p', previewText: 't' }, ctx),
    ).rejects.toMatchObject({ code: 'unknown', outcome: 'unknown' })
  })
})

describe('远端模型列表 native("listModels")', () => {
  const list = (replies: unknown[], settings?: Record<string, unknown>) => {
    const f = hostContext(replies as never[], { settings })
    return { ...f, run: () => minimaxAdapter.native!('listModels', {}, f.ctx) }
  }
  it('按地区取 /v1/models，条目键 model 或 id 都接受', async () => {
    const f = list([
      {
        base_resp: { status_code: 0 },
        data: [
          { model: 'MiniMax-M3', owned_by: 'minimax', created: 1700000000 },
          { id: 'music-3.0' },
        ],
      },
    ])
    expect(await f.run()).toEqual([
      { id: 'MiniMax-M3', ownedBy: 'minimax', created: 1700000000, features: ['structured'] },
      { id: 'music-3.0', features: ['structured'] },
    ])
    expect(f.fetch.mock.calls[0]![0]).toBe('https://api.minimax.cn/v1/models')
    expect((f.fetch.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    )
  })
  it('全球地区换域名，鉴权失败时抛错', async () => {
    const f = list([Response.json({ base_resp: { status_code: 1004 } }, { status: 401 })], {
      region: 'global',
    })
    await expect(f.run()).rejects.toThrow(/列表失败/)
    expect(String(f.fetch.mock.calls[0]![0])).toBe('https://api.minimax.io/v1/models')
  })
  it('没有 data 数组、或 200 里带业务错误时报错', async () => {
    await expect(list([{ base_resp: { status_code: 0 } }]).run()).rejects.toThrow(/data/)
    await expect(
      list([{ base_resp: { status_code: 1004, status_msg: 'invalid key test-key' } }]).run(),
    ).rejects.toMatchObject({ code: 'auth', message: 'MiniMax：invalid key [redacted]' })
  })
  it('声明 listModels 原生操作', () => {
    expect(minimaxAdapter.nativeOperations).toContain('listModels')
  })
})
