import type { ModelDeclaration } from '@modelbay/core'

/**
 * qwen-audio-3.1-asr-flash-filetrans：百炼的录音文件转写模型（异步任务：提交后轮询，结果在 transcription_url）。
 * 走 native `asr-filetrans`，不走同步识别。
 *
 * 来源（2026-11-11 核对）：
 * - https://help.aliyun.com/zh/model-studio/asr-model「12小时 / 2GB」「公网可访问的文件 URL，单次 1 个」
 * - https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api：提交接口
 *   `POST /api/v1/services/audio/asr/transcription`，「必须传入 parameters；无需设置参数时传入空对象 {}」
 */
export default {
  canonicalId: 'aliyun/qwen-audio-3.1-asr-flash-filetrans',
  id: 'qwen-audio-3.1-asr-flash-filetrans',
  title: 'Qwen-Audio-ASR 3.1 Flash 文件转写',
  description:
    '录音文件转写（异步任务）：单个文件最长 12 小时、2GB，支持说话人分离与热词，返回全文和带时间戳的句子。',
  capabilities: ['audio.transcribe'],
  native: ['asr-filetrans'],
  channels: [
    {
      channel: 'bailian',
      id: 'qwen-audio-3.1-asr-flash-filetrans',
      endpoint: '/api/v1/services/audio/asr/transcription',
    },
  ],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: { url: 'https://help.aliyun.com/zh/model-studio/asr-model', checkedAt: '2026-11-11' },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api',
    checkedAt: '2026-11-11',
  },
} satisfies ModelDeclaration
