import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen-audio-3.1-tts-next：百炼的音频生成模型（自然语言描述整段音频，可引用最多 3 段参考音色）。
 *
 * 请求体与 audio.speech 不同（input.text_prompt + references，没有 voice），所以走 native
 * `audio-generation`，不经 text_to_speech；能力记为最接近的 audio.speech。
 * 参考音色只收 URL 或 Data URI，不支持系统音色与复刻音色 ID。
 *
 * 来源（2026-11-11 核对）：
 * - https://help.aliyun.com/zh/model-studio/audio-generation-api：
 *   `POST /api/v1/services/audio/tts/SpeechSynthesizer`；「text_prompt…最大 3000 字符」；
 *   references「最多 3 个，每个不超过 30 秒、10 MB」，WAV / MP3 / OGG Opus；
 *   format wav / mp3 / pcm（默认 wav），sample_rate 默认 48000，channels 默认 2，volume 0–100（默认 50），
 *   rate 0.5–2.0，seed 默认 42；输出 output.audio.url 24 小时有效；播客场景最长 240 秒，其他场景 120 秒
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.1-tts-next',
  id: 'qwen-audio-3.1-tts-next',
  title: 'Qwen-Audio-TTS 3.1 Next 音频生成',
  description:
    '用自然语言描述整段音频（多角色对话、播客、带情绪的旁白），提示词里用 @voice1–@voice3 引用参考音色；播客最长 240 秒，其他 120 秒。',
  capabilities: ['audio.speech'],
  native: ['audio-generation'],
  limits: {
    promptMaxLength: 3000,
    references: { max: 3 },
    speed: { min: 0.5, max: 2 },
    sampleRates: [8000, 16000, 24000, 44100, 48000],
    media: {
      audio: {
        mime: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/opus'],
        maxMB: 10,
        maxDuration: 30,
      },
    },
  },
  optionsSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      format: {
        title: '输出格式',
        description: '官方默认 wav；不支持 opus 输出',
        type: 'string',
        enum: ['wav', 'mp3', 'pcm'],
      },
      sample_rate: {
        title: '采样率',
        description: '官方默认 48000',
        type: 'integer',
        enum: [8000, 16000, 24000, 44100, 48000],
      },
      channels: {
        title: '声道',
        description: '1 单声道，2 立体声（官方默认）',
        type: 'integer',
        enum: [1, 2],
      },
      volume: {
        title: '音量',
        description: '官方默认 50',
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      rate: {
        title: '语速',
        description: '官方默认 1.0',
        type: 'number',
        minimum: 0.5,
        maximum: 2,
      },
      seed: { title: '随机种子', description: '官方默认 42', type: 'integer' },
      enable_cbr: { title: 'MP3 固定码率', description: '仅 mp3；官方默认 false', type: 'boolean' },
      bit_rate: {
        title: 'MP3 码率（kbps）',
        description: '仅 mp3 固定码率；超范围会被截断',
        type: 'integer',
      },
      quality: {
        title: 'MP3 可变码率质量',
        description: '仅 mp3 可变码率；0 最高，官方默认 5',
        type: 'integer',
        minimum: 0,
        maximum: 9,
      },
      enable_aigc_tag: { title: 'AIGC 水印', description: '官方默认 false', type: 'boolean' },
    },
  },
  channels: [{ channel: 'bailian', id: 'qwen-audio-3.1-tts-next' }],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/audio-generation-api',
      checkedAt: '2026-11-11',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/audio-generation-api',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
