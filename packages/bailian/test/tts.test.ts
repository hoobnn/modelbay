import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import {
  audioFile,
  checkTts,
  choiceContents,
  defaultTtsModel,
  defaultVoiceFor,
  hexBytes,
  instructionLength,
  instructionModelIds,
  parseMinimaxTtsResponse,
  parseTtsResponse,
  parseUsage,
  QWEN_TTS_PATH,
  resolveTtsModel,
  splitText,
  synthModelIds,
  SYNTH_PATH,
  synthesizeMinimaxTts,
  synthesizeQwenAudioTts,
  TTS_CHUNK,
  ttsModels,
  ttsRequest,
} from '../src/tts'
import { createBailianAdapter } from '../src/adapter'
import { all } from '../src/models/index'
import { fakeContext, fixture } from './helpers'

const models = ttsModels(all)

/** 默认不传模型/音色/参数，按需覆盖。 */
function opts(
  changes: Partial<Parameters<typeof ttsRequest>[1]> = {},
): Parameters<typeof ttsRequest>[1] {
  return { text: 'hi', ...changes }
}

describe('splitText / instructionLength', () => {
  it('packs sentences into chunks up to the limit ', () => {
    expect(splitText('你好。世界！')).toEqual(['你好。世界！'])
    expect(splitText('你好。世界！', 3)).toEqual(['你好。', '世界！'])
  })
  it('hard-splits a sentence longer than the limit', () => {
    const text = '啊'.repeat(600)
    const parts = splitText(text)
    expect(parts.length).toBe(3)
    expect(parts.every((part) => part.length <= TTS_CHUNK)).toBe(true)
  })
  it('drops whitespace-only chunks', () => {
    expect(splitText('   \n ')).toEqual([])
  })
  it('counts CJK as 2 and latin as 1', () => {
    expect(instructionLength('中文ab')).toBe(6)
    expect(instructionLength('')).toBe(0)
    expect(instructionLength('慢a')).toBe(3)
  })
})

describe('ttsModels（声明驱动）', () => {
  it('读出全部配音模型，并按声明的 endpoint 区分协议', () => {
    expect(models.map((model) => model.id)).toContain('qwen-audio-3.1-tts-flash')
    expect(models.map((model) => model.id)).toContain('qwen3-tts-flash')
    expect(synthModelIds(models)).toContain('cosyvoice-v2')
    expect(synthModelIds(models)).not.toContain('qwen3-tts-flash')
  })
  it('已下线的模型不进这个清单', () => {
    expect(models.map((model) => model.id)).not.toContain('qwen3-tts-instruct-flash')
  })
  it('默认模型来自声明（带 default 标记的 active 模型）', () => {
    expect(defaultTtsModel(models)?.id).toBe('qwen-audio-3.1-tts-flash')
  })
  it('指令支持范围来自声明', () => {
    const ids = instructionModelIds(models)
    expect(ids).toContain('qwen-audio-3.1-tts-flash')
    expect(ids).not.toContain('qwen3-tts-flash')
    expect(ids).not.toContain('cosyvoice-v2')
  })
})

describe('resolveTtsModel', () => {
  it('解析声明里的简称', () => {
    expect(resolveTtsModel(models, { model: 'audio-plus' })).toBe('qwen-audio-3.0-tts-plus')
    expect(resolveTtsModel(models, { model: 'audio' })).toBe('qwen-audio-3.0-tts-flash')
    expect(resolveTtsModel(models, { model: 'cosyvoice' })).toBe('cosyvoice-v3.5-plus')
    expect(resolveTtsModel(models, { model: 'flash' })).toBe('qwen3-tts-flash')
  })
  it('完整模型 ID 原样透传', () => {
    expect(resolveTtsModel(models, { model: 'qwen-audio-3.1-tts-flash' })).toBe(
      'qwen-audio-3.1-tts-flash',
    )
  })
  it('按自定义音色前缀推断模型', () => {
    expect(resolveTtsModel(models, { voice: 'cosyvoice-v3.5-plus-myvoice' })).toBe(
      'cosyvoice-v3.5-plus',
    )
    expect(resolveTtsModel(models, { voice: 'qwen-audio-3.1-tts-flash-me-1' })).toBe(
      'qwen-audio-3.1-tts-flash',
    )
  })
  it('没传音色、参数且 language 为空或语种代码时用默认模型', () => {
    expect(resolveTtsModel(models, {})).toBe('qwen-audio-3.1-tts-flash')
    expect(resolveTtsModel(models, { language: 'zh' })).toBe('qwen-audio-3.1-tts-flash')
    expect(resolveTtsModel(models, { language: 'other' })).toBe('qwen-audio-3.1-tts-flash')
  })
  it('旧调用（qwen3 音色、非语种代码、带参数）回落到兼容模型', () => {
    expect(resolveTtsModel(models, { voice: 'Cherry' })).toBe('qwen3-tts-flash')
    expect(resolveTtsModel(models, { language: 'Chinese' })).toBe('qwen3-tts-flash')
    expect(resolveTtsModel(models, { parameters: { x: 1 } })).toBe('qwen3-tts-flash')
  })
})

describe('defaultVoiceFor', () => {
  it('默认模型在没显式指定模型时用它声明的默认音色', () => {
    expect(defaultVoiceFor(models, 'qwen-audio-3.1-tts-flash', false)).toBe('longanhuan_v3.1')
  })
  it('显式指定了合成模型时不替他挑音色', () => {
    expect(defaultVoiceFor(models, 'qwen-audio-3.1-tts-flash', true)).toBeUndefined()
  })
  it('多模态协议的模型用自己声明的默认音色', () => {
    expect(defaultVoiceFor(models, 'qwen3-tts-flash', true)).toBe('Cherry')
  })
})

describe('ttsRequest', () => {
  it('走 SpeechSynthesizer 协议，wav/24000', () => {
    const { path, body } = ttsRequest(
      'qwen-audio-3.1-tts-flash',
      { text: 'hi', voice: 'v' },
      'hi',
      models,
    )
    expect(path).toBe(SYNTH_PATH)
    expect(body).toEqual({
      model: 'qwen-audio-3.1-tts-flash',
      input: { text: 'hi', voice: 'v', format: 'wav', sample_rate: 24000 },
    })
  })
  it('带上 instruction / language_hints 并合并 parameters', () => {
    const { body } = ttsRequest(
      'qwen-audio-3.1-tts-flash',
      { text: 'hi', voice: 'v', instructions: 'soft', language: 'zh', parameters: { speed: 1.1 } },
      'hi',
      models,
    )
    expect((body.input as Record<string, unknown>).instruction).toBe('soft')
    expect((body.input as Record<string, unknown>).language_hints).toEqual(['zh'])
    expect((body.input as Record<string, unknown>).speed).toBe(1.1)
  })
  it('qwen3-tts 走多模态生成接口，parameters 在顶层', () => {
    const { path, body } = ttsRequest(
      'qwen3-tts-flash',
      { text: 'hi', voice: 'Cherry', language: 'Auto', parameters: { n: 1 } },
      'hi',
      models,
    )
    expect(path).toBe(QWEN_TTS_PATH)
    expect(body).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: 'hi', voice: 'Cherry', language_type: 'Auto' },
      parameters: { n: 1 },
    })
  })
})

describe('checkTts', () => {
  it('合成模型必须给音色', () => {
    expect(checkTts('qwen-audio-3.1-tts-flash', { text: 'hi' }, models)).toMatch(/必须指定/)
  })
  it('拒绝声明里不支持指令的模型', () => {
    expect(
      checkTts('cosyvoice-v2', { text: 'hi', voice: 'v', instructions: 'soft' }, models),
    ).toMatch(/不支持语气指令/)
    expect(
      checkTts('qwen3-tts-flash', { text: 'hi', voice: 'v', instructions: 'soft' }, models),
    ).toMatch(/不支持 instructions/)
  })
  it('拒绝超过声明上限的 CosyVoice 指令', () => {
    expect(
      checkTts(
        'cosyvoice-v3.5-plus',
        { text: 'hi', voice: 'v', instructions: '啊'.repeat(60) },
        models,
      ),
    ).toMatch(/100/)
  })
  it('拒绝非法语种代码和用错模型的 language=other', () => {
    expect(
      checkTts('cosyvoice-v3.5-plus', { text: 'hi', voice: 'v', language: 'Chinese' }, models),
    ).toMatch(/语言须为/)
    expect(
      checkTts('qwen-audio-3.0-tts-flash', { text: 'hi', voice: 'v', language: 'other' }, models),
    ).toMatch(/仅适用于/)
  })
  it('拒绝 parameters 覆盖受保护字段与非 wav 的本地交付', () => {
    expect(
      checkTts(
        'qwen-audio-3.1-tts-flash',
        { text: 'hi', voice: 'v', parameters: { text: 'x' } },
        models,
      ),
    ).toMatch(/不能覆盖/)
    expect(
      checkTts(
        'qwen-audio-3.1-tts-flash',
        { text: 'hi', voice: 'v', parameters: { format: 'mp3' } },
        models,
        'local',
      ),
    ).toMatch(/WAV/)
  })
  it('拒绝未知模型', () => {
    expect(checkTts('qwen3-tts-flash-realtime', { text: 'hi', voice: 'v' }, models)).toMatch(
      /不支持的语音模型/,
    )
  })
  it('接受合法的合成请求', () => {
    expect(
      checkTts('qwen-audio-3.1-tts-flash', { text: 'hi', voice: 'v', language: 'zh' }, models),
    ).toBeNull()
  })
})

describe('parseTtsResponse / parseUsage / audioFile / choiceContents', () => {
  it('parses audio.url, request_id and usage', () => {
    const f = fixture('tts-synthesizer')
    expect(parseTtsResponse(f.response.body)).toEqual({
      url: 'https://example.com/tts.wav',
      requestId: 'req-tts-1',
      usage: { characters: 5 },
    })
  })
  it('throws when audio.url is missing', () => {
    expect(() => parseTtsResponse({ output: {} })).toThrow(ProviderError)
  })
  it('normalizes all usage counters', () => {
    expect(
      parseUsage({
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          image_count: 3,
          characters: 4,
          duration: 5,
        },
      }),
    ).toEqual({ inputTokens: 1, outputTokens: 2, images: 3, characters: 4, seconds: 5 })
    expect(
      parseUsage({ usage: { prompt_tokens: 7, completion_tokens: 8, output_image_count: 9 } }),
    ).toEqual({
      inputTokens: 7,
      outputTokens: 8,
      images: 9,
    })
  })
  it('audioFile upgrades http to https', () => {
    expect(audioFile({ output: { audio: { url: 'http://example.com/a.wav' } } })).toMatchObject({
      url: 'https://example.com/a.wav',
      kind: 'audio',
    })
    expect(() => audioFile({ output: {} })).toThrow(ProviderError)
  })
  it('choiceContents flattens content parts', () => {
    expect(
      choiceContents({ output: { choices: [{ message: { content: [{ image: 'u' }] } }] } }),
    ).toEqual([{ image: 'u' }])
  })
})

describe('synthesizeQwenAudioTts (recorded fixtures)', () => {
  it('builds the SpeechSynthesizer request and parses the response', async () => {
    const f = fixture('tts-synthesizer')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await synthesizeQwenAudioTts(
      ctx,
      {
        text: '你好，世界。',
        model: 'qwen-audio-3.1-tts-flash',
        voice: 'qwen-audio-3.1-tts-flash-custom',
        instructions: '用温柔的语气',
        language: 'zh',
      },
      models,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect(result.url).toBe('https://example.com/tts.wav')
  })
  it('builds the legacy qwen3-tts request', async () => {
    const f = fixture('tts-qwen')
    const { ctx, calls } = fakeContext([f.response.body])
    await synthesizeQwenAudioTts(
      ctx,
      {
        text: '测试文本',
        model: 'qwen3-tts-flash',
        voice: 'Cherry',
        language: 'Auto',
      },
      models,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
  })
  it('rejects empty text, multi-chunk text and invalid options', async () => {
    const { ctx } = fakeContext([])
    await expect(synthesizeQwenAudioTts(ctx, { text: '' }, models)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      synthesizeQwenAudioTts(ctx, { text: '啊'.repeat(300) }, models),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      synthesizeQwenAudioTts(
        ctx,
        {
          text: 'hi',
          model: 'qwen-audio-3.1-tts-flash',
          language: 'Chinese',
        },
        models,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

// ── 官方接口契约用例 ──────────

describe('移植：tts_routes_by_model_and_custom_voice_prefix', () => {
  const cases: [Parameters<typeof ttsRequest>[1], string][] = [
    [
      opts({ model: 'audio', voice: 'longanhuan_v3.6', instructions: '用温柔的语气' }),
      'qwen-audio-3.0-tts-flash',
    ],
    [
      opts({ model: 'qwen-audio-3.1-tts-plus', voice: 'system-voice', language: 'zh' }),
      'qwen-audio-3.1-tts-plus',
    ],
    [
      opts({ voice: 'qwen-audio-3.1-tts-plus-vd-me-1', instructions: '慢一点' }),
      'qwen-audio-3.1-tts-plus',
    ],
    [
      opts({ voice: 'cosyvoice-v3.5-plus-vd-me-1', parameters: { rate: 1.2 } }),
      'cosyvoice-v3.5-plus',
    ],
  ]
  it('按模型与自定义音色前缀路由到 SpeechSynthesizer', async () => {
    for (const [options, model] of cases) {
      const { ctx, calls } = fakeContext([{ code: 'InvalidParameter', message: 'stop' }])
      await synthesizeQwenAudioTts(ctx, options, models).catch(() => undefined)
      const [path, body] = [calls()[0]?.url, calls()[0]?.body as Record<string, unknown>]
      expect(path).toContain(SYNTH_PATH)
      expect(body?.model).toBe(model)
      expect(Object.keys(body ?? {}).sort()).toEqual(['input', 'model'])
      expect((body.input as Record<string, unknown>).voice).toBe(options.voice)
    }
  })
  it('parameters 合并进 input（rate 1.2）', async () => {
    const { ctx, calls } = fakeContext([{ code: 'InvalidParameter', message: 'stop' }])
    await synthesizeQwenAudioTts(
      ctx,
      opts({ voice: 'cosyvoice-v3.5-plus-vd-me-1', parameters: { rate: 1.2 } }),
      models,
    ).catch(() => undefined)
    const body = calls()[0]?.body as Record<string, unknown>
    expect((body.input as Record<string, unknown>).rate).toBe(1.2)
  })
  it('默认调用用 qwen-audio-3.1-tts-flash + longanhuan_v3.1', async () => {
    const { ctx, calls } = fakeContext([{ code: 'InvalidParameter', message: 'stop' }])
    await synthesizeQwenAudioTts(ctx, opts(), models).catch(() => undefined)
    const body = calls()[0]?.body as Record<string, unknown>
    expect(calls()[0]?.url).toContain(SYNTH_PATH)
    expect(body?.model).toBe('qwen-audio-3.1-tts-flash')
    expect((body.input as Record<string, unknown>).voice).toBe('longanhuan_v3.1')
  })
  it('旧调用走 qwen3-tts-flash + Cherry', async () => {
    for (const legacy of [
      opts({ voice: 'Cherry' }),
      opts({ language: 'Chinese' }),
      opts({ parameters: { x: 1 } }),
    ]) {
      const { ctx, calls } = fakeContext([{ code: 'InvalidParameter', message: 'stop' }])
      await synthesizeQwenAudioTts(ctx, legacy, models).catch(() => undefined)
      const body = calls()[0]?.body as Record<string, unknown>
      expect(calls()[0]?.url).toContain(QWEN_TTS_PATH)
      expect(body?.model).toBe('qwen3-tts-flash')
      expect((body.input as Record<string, unknown>).voice).toBe('Cherry')
    }
  })
})

describe('移植：tts_request_bodies_follow_each_protocol', () => {
  it('SpeechSynthesizer 的请求体形状', () => {
    const { path, body } = ttsRequest(
      'qwen-audio-3.0-tts-plus',
      opts({ voice: 'v', instructions: '慢一点', language: 'en' }),
      'hi',
      models,
    )
    expect(path).toBe(SYNTH_PATH)
    expect(body).toEqual({
      model: 'qwen-audio-3.0-tts-plus',
      input: {
        text: 'hi',
        voice: 'v',
        format: 'wav',
        sample_rate: 24000,
        instruction: '慢一点',
        language_hints: ['en'],
      },
    })
  })
  it('多模态生成的请求体形状', () => {
    const { path, body } = ttsRequest(
      'qwen3-tts-flash',
      opts({ voice: 'Cherry', language: 'English', parameters: { x: 1 } }),
      'hi',
      models,
    )
    expect(path).toBe(QWEN_TTS_PATH)
    expect(body).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: 'hi', voice: 'Cherry', language_type: 'English' },
      parameters: { x: 1 },
    })
  })
  it('自定义音色前缀反推模型', () => {
    expect(resolveTtsModel(models, { voice: 'qwen-audio-3.1-tts-flash-me-1' })).toBe(
      'qwen-audio-3.1-tts-flash',
    )
  })
})

describe('移植：speech_synthesizer_local_validation', () => {
  const cases: Parameters<typeof ttsRequest>[1][] = [
    opts({ model: 'audio' }),
    opts({ model: 'cosyvoice-v2', voice: 'v', instructions: '慢' }),
    opts({ model: 'cosyvoice', voice: 'v', instructions: '慢'.repeat(51) }),
    opts({ model: 'audio', voice: 'v', language: 'Chinese' }),
    opts({ model: 'cosyvoice', voice: 'v', parameters: { instruction: '慢'.repeat(51) } }),
    opts({ model: 'cosyvoice-v2', voice: 'v', parameters: { instruction: 'slow' } }),
    opts({ model: 'audio', voice: 'v', parameters: { voice: 'x' } }),
  ]
  it('非法参数在发请求前就被挡住', async () => {
    for (const options of cases) {
      const { ctx, calls } = fakeContext([])
      await expect(
        synthesizeQwenAudioTts(ctx, options, models).catch((error) => {
          throw error
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(calls()).toHaveLength(0)
    }
  })
  it('本地交付只接受 wav 拼接', () => {
    expect(
      checkTts(
        'qwen-audio-3.0-tts-flash',
        opts({ model: 'audio', voice: 'v', parameters: { format: 'mp3' } }),
        models,
        'local',
      ),
    ).toMatch(/WAV/)
  })
})

describe('移植：other_language_is_scoped_to_qwen_audio_31_flash', () => {
  it('只有 qwen-audio-3.1-tts-flash 允许 language=other', () => {
    const options = opts({
      model: 'qwen-audio-3.1-tts-flash',
      voice: 'v',
      language: 'other',
      instructions: '请用荷兰话说',
    })
    expect(checkTts(options.model as string, options, models)).toBeNull()
    const body = ttsRequest(options.model as string, options, 'Hallo', models).body
    expect((body.input as Record<string, unknown>).language_hints).toEqual(['other'])
    expect((body.input as Record<string, unknown>).instruction).toBe('请用荷兰话说')
    for (const model of synthModelIds(models).filter((id) => id !== 'qwen-audio-3.1-tts-flash')) {
      expect(checkTts(model, opts({ model, voice: 'v', language: 'other' }), models)).toMatch(
        /仅适用于/,
      )
    }
  })
})

describe('移植：qwen_audio_instruction_does_not_inherit_cosyvoice_character_limit', () => {
  it('Qwen-Audio-TTS 的指令不受 CosyVoice 的 100 字符限制', () => {
    for (const model of models
      .filter((item) => item.id.startsWith('qwen-audio-'))
      .map((item) => item.id)) {
      const options = opts({ model, voice: 'v', instructions: '慢'.repeat(51) })
      expect(checkTts(model, options, models)).toBeNull()
      expect(
        (ttsRequest(model, options, 'hi', models).body.input as Record<string, unknown>)
          .instruction,
      ).toBe('慢'.repeat(51))
    }
  })
})

// ── MiniMax 语音协议（百炼转售） ──────────

const MINIMAX_MODEL = 'MiniMax/speech-2.8-hd'

describe('MiniMax 协议（声明驱动）', () => {
  it('声明里的 protocol 决定协议，不靠接口路径猜', () => {
    const model = models.find((item) => item.id === MINIMAX_MODEL)
    expect(model?.protocol).toBe('minimax')
    // 与 CosyVoice / qwen3-tts 同一条接口，但请求体形状不同
    expect(model?.endpoint).toBe(QWEN_TTS_PATH)
    expect(models.find((item) => item.id === 'qwen3-tts-flash')?.protocol).toBe('multimodal')
    expect(models.find((item) => item.id === 'cosyvoice-v2')?.protocol).toBe('synthesizer')
  })

  it('请求体用 input.voice_setting，音色参数扁平归进去', () => {
    const { path, body } = ttsRequest(
      MINIMAX_MODEL,
      {
        text: '你好',
        voice: 'male-qn-qingse',
        parameters: {
          speed: 1.2,
          vol: 2,
          pitch: -3,
          emotion: 'happy',
          audio_setting: { sample_rate: 32000, format: 'mp3' },
        },
      },
      '你好',
      models,
    )
    expect(path).toBe(QWEN_TTS_PATH)
    expect(body).toEqual({
      model: MINIMAX_MODEL,
      input: {
        text: '你好',
        voice_setting: {
          voice_id: 'male-qn-qingse',
          speed: 1.2,
          vol: 2,
          pitch: -3,
          emotion: 'happy',
        },
        audio_setting: { sample_rate: 32000, format: 'mp3' },
      },
    })
  })

  it('language 映射到 language_boost', () => {
    const { body } = ttsRequest(
      MINIMAX_MODEL,
      { text: '你好', voice: 'v', language: 'Chinese' },
      '你好',
      models,
    )
    expect((body.input as Record<string, unknown>).language_boost).toBe('Chinese')
  })

  it('voice_setting 整体传时保留其中的字段，音色 ID 仍以 voice 为准', () => {
    const { body } = ttsRequest(
      MINIMAX_MODEL,
      {
        text: '你好',
        voice: 'male-qn-qingse',
        parameters: { voice_setting: { voice_id: 'other', timbre_weights: [] } },
      },
      '你好',
      models,
    )
    const voice = (body.input as Record<string, unknown>).voice_setting as Record<string, unknown>
    expect(voice.voice_id).toBe('male-qn-qingse')
    expect(voice.timbre_weights).toEqual([])
  })

  it('必须给音色，不支持自然语言指令', () => {
    expect(checkTts(MINIMAX_MODEL, { text: 'hi' }, models)).toMatch(/必须指定音色/)
    expect(
      checkTts(MINIMAX_MODEL, { text: 'hi', voice: 'v', instructions: '温柔点' }, models),
    ).toMatch(/不支持 instructions/)
    expect(
      checkTts(MINIMAX_MODEL, { text: 'hi', voice: 'v', parameters: { text: 'x' } }, models),
    ).toMatch(/不能覆盖/)
    expect(checkTts(MINIMAX_MODEL, { text: 'hi', voice: 'v', language: 'zh-CN' }, models)).toMatch(
      /语种名/,
    )
  })

  it('hex 音频解码成字节，规格从 extra_info 取', () => {
    const f = fixture('tts-minimax')
    const result = parseMinimaxTtsResponse(f.response.body)
    expect(result.output).toMatchObject({
      type: 'file',
      kind: 'audio',
      mime: 'audio/mpeg',
      name: 'bailian.mp3',
    })
    const data = (result.output as { data: Uint8Array }).data
    expect([...data]).toEqual([0x49, 0x44, 0x33])
    expect(result.usage).toEqual({ characters: 34, seconds: 4.536 })
  })

  it('缺音频数据时报错且不重试', () => {
    expect(() => parseMinimaxTtsResponse({ output: { data: {} } })).toThrow(ProviderError)
  })

  it('hexBytes 解出字节', () => {
    expect([...hexBytes('494433')]).toEqual([0x49, 0x44, 0x33])
  })

  it('合成请求按官方契约发出', async () => {
    const f = fixture('tts-minimax')
    const { ctx, calls } = fakeContext([f.response.body])
    const result = await synthesizeMinimaxTts(
      ctx,
      {
        text: '今天是不是很开心呀',
        model: MINIMAX_MODEL,
        voice: 'male-qn-qingse',
        parameters: {
          speed: 1,
          vol: 1,
          pitch: 0,
          emotion: 'happy',
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        },
      },
      models,
    )
    expect(calls()[0]?.url).toBe(f.request.url)
    expect(calls()[0]?.body).toEqual(f.request.body)
    expect((result.output as { data: Uint8Array }).data.length).toBe(3)
  })

  it('没给音色时在发请求前就拒绝', async () => {
    const { ctx, calls } = fakeContext([])
    await expect(
      synthesizeMinimaxTts(ctx, { text: 'hi', model: MINIMAX_MODEL }, models),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls()).toHaveLength(0)
  })
  it('SDK 传了 instruction 时在发请求前拒绝', async () => {
    const adapter = createBailianAdapter(all)
    const { ctx, calls } = fakeContext([])
    await expect(
      adapter.submit(
        {
          capability: 'audio.speech',
          model: MINIMAX_MODEL,
          input: { text: 'hi', voice: 'male-qn-qingse', instruction: '温柔一点' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls()).toHaveLength(0)
  })

  it('原生 qwen-audio-tts 不接 MiniMax 模型，提交前就拒绝', async () => {
    const adapter = createBailianAdapter(all)
    const { ctx, calls } = fakeContext([])
    await expect(
      adapter.native!('qwen-audio-tts', { model: MINIMAX_MODEL, text: 'hi', voice: 'v' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls()).toHaveLength(0)
  })
})
