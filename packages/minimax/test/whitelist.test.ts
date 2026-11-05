/** MCP 目录声明的参数白名单：能到达请求体；白名单外的未知字段仍被丢弃。 */
import { describe, expect, it } from 'vite-plus/test'
import type { AdapterRequest } from '@modelbay/core'
import { minimaxAdapter as adapter } from '../src/index'
import { hostContext } from './helpers'

const run = (request: AdapterRequest, replies: unknown[]) => {
  const f = hostContext(replies as never[])
  return { ...f, done: adapter.submit(request, f.ctx) }
}

describe('video 白名单', () => {
  it.each(['extra', 'parameters'])(
    'callback_url / aigc_watermark 经 %s 到达请求体',
    async (where) => {
      const f = run(
        {
          capability: 'video.generate',
          model: 'MiniMax-H3',
          input: {
            prompt: 'p',
            [where]: {
              callback_url: 'https://cb',
              aigc_watermark: true,
              evil: 1,
              model: 'x',
              content: [],
            },
          },
        } as AdapterRequest,
        [{ task_id: 't' }],
      )
      await f.done
      expect(f.body()).toMatchObject({
        callback_url: 'https://cb',
        aigc_watermark: true,
        model: 'MiniMax-H3',
      })
      expect(f.body()).not.toHaveProperty('evil')
      expect(f.body().content).toHaveLength(1)
    },
  )
  it('类型不对在联网前拒绝', async () => {
    const f = run(
      {
        capability: 'video.generate',
        model: 'MiniMax-H3',
        input: { prompt: 'p', extra: { aigc_watermark: 'yes' } },
      } as AdapterRequest,
      [],
    )
    await expect(f.done).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('speech 白名单', () => {
  const speech = (input: Record<string, unknown>) =>
    ({
      capability: 'audio.speech',
      model: 'speech-2.8-hd',
      input: { text: '你好', ...input },
    }) as AdapterRequest
  it('vol / pitch / emotion / 音频设置 / language_boost 到达请求体，未知字段丢弃', async () => {
    const f = run(
      speech({
        vol: 2,
        pitch: -3,
        emotion: 'happy',
        sample_rate: 24000,
        bitrate: 64000,
        channel: 2,
        format: 'wav',
        language_boost: 'Chinese',
        extra: { evil: 1 },
        parameters: {
          stream: true,
          voice_setting: { vol: 3 },
          audio_setting: { sample_rate: 16000 },
        },
      }),
      [{ data: { audio: '0102' } }],
    )
    const result = await f.done
    expect(f.body()).toMatchObject({
      stream: false,
      language_boost: 'Chinese',
      voice_setting: { voice_id: 'male-qn-qingse', vol: 2, pitch: -3, emotion: 'happy' },
      audio_setting: { format: 'wav', sample_rate: 24000, bitrate: 64000, channel: 2 },
    })
    expect(f.body()).not.toHaveProperty('evil')
    expect(result).toMatchObject({ outputs: [{ mime: 'audio/wav' }] })
  })
  it('嵌套的 voice_setting / audio_setting 与 extra.emotion 也生效', async () => {
    const f = run(
      speech({
        extra: { emotion: 'calm' },
        parameters: { voice_setting: { vol: 3, pitch: 5 }, audio_setting: { sample_rate: 16000 } },
      }),
      [{ data: { audio: '0102' } }],
    )
    await f.done
    expect(f.body()).toMatchObject({
      voice_setting: { vol: 3, pitch: 5, emotion: 'calm' },
      audio_setting: { sample_rate: 16000, format: 'mp3' },
    })
  })
  it.each([
    { vol: 0 },
    { vol: 11 },
    { pitch: 13 },
    { pitch: 1.5 },
    { format: 'ogg' },
    { channel: 1.5 },
  ])('非法 %j 在联网前拒绝', async (input) => {
    const f = run(speech(input), [])
    await expect(f.done).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('music 白名单', () => {
  it('lyrics / is_instrumental / lyrics_optimizer / audio_setting 到达请求体', async () => {
    const f = run(
      {
        capability: 'audio.music',
        model: 'music-3.0',
        input: {
          prompt: 'p',
          lyrics: '啦啦',
          is_instrumental: false,
          lyrics_optimizer: true,
          parameters: {
            audio_setting: { format: 'wav', sample_rate: 32000 },
            stream: true,
            evil: 1,
          },
        },
      } as AdapterRequest,
      [{ data: { audio: '01' } }],
    )
    await f.done
    expect(f.body()).toMatchObject({
      lyrics: '啦啦',
      is_instrumental: false,
      lyrics_optimizer: true,
      stream: false,
      audio_setting: { format: 'wav', sample_rate: 32000, bitrate: 256000 },
    })
    expect(f.body()).not.toHaveProperty('evil')
  })
})

describe('image 白名单', () => {
  const urls = { data: { image_urls: ['https://cdn.hailuoai.com/a.png'] } }
  it('MCP 形态：aspect_ratio / n / prompt_optimizer / parameters.style / seed / aigc_watermark', async () => {
    const f = run(
      {
        capability: 'image.generate',
        model: 'image-01-live',
        input: {
          prompt: '猫',
          aspect_ratio: '3:4',
          n: 2,
          prompt_optimizer: true,
          parameters: {
            style: { style_type: '水彩', style_weight: 0.5 },
            seed: 7,
            aigc_watermark: true,
            response_format: 'base64',
            evil: 1,
          },
        },
      } as AdapterRequest,
      [urls],
    )
    await f.done
    expect(f.body()).toMatchObject({
      n: 2,
      aspect_ratio: '3:4',
      seed: 7,
      prompt_optimizer: true,
      aigc_watermark: true,
      response_format: 'url',
      style: { style_type: '水彩', style_weight: 0.5 },
    })
    expect(f.body()).not.toHaveProperty('evil')
  })
})
