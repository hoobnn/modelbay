/** DeepSeek 独立语音服务没有 model 参数。
 * 来源：https://api-docs.deepseek.com/guides/tts、/guides/asr（2026-11-13）。
 */
import { ProviderError, type AdapterContext, type ProviderOutput } from '@modelbay/core'
import { apiKey, baseUrl, sendRequest } from './http'

export interface TtsOptions {
  text: string
  voice_id?: 'stella' | 'tide'
  format?: 'wav' | 'pcm'
  filter_markdown?: boolean
}

function validateText(text: string) {
  if (typeof text !== 'string' || !text.trim())
    throw new ProviderError('invalid_input', 'TTS text 不能为空')
}

/** HTTP 音频流原样返回；宿主须完整消费 body，读取失败不能重新提交。 */
export async function textToSpeech(ctx: AdapterContext, options: TtsOptions): Promise<Response> {
  validateText(options.text)
  return sendRequest(ctx, '/v1/tools/tts', 'POST', JSON.stringify(options), {
    'Content-Type': 'application/json',
  })
}

/** MCP 和一次性 SDK 调用使用文件输出，支持现有 out_dir 交付。 */
export async function synthesizeSpeech(ctx: AdapterContext, options: TtsOptions) {
  const response = await textToSpeech(ctx, options)
  let data: Uint8Array
  try {
    data = new Uint8Array(await response.arrayBuffer())
  } catch (cause) {
    throw new ProviderError(
      ctx.signal.aborted ? 'cancelled' : 'unavailable',
      'DeepSeek 音频流读取失败；请勿自动重新提交',
      {
        cause,
        outcome: 'unknown',
        retryable: false,
      },
    )
  }
  const mime = options.format === 'pcm' ? 'audio/pcm' : 'audio/wav'
  if (!data.length)
    throw new ProviderError('unknown', 'DeepSeek 返回空音频', { outcome: 'unknown' })
  // WAV data chunk 的长度可发现服务在已开始输出后截断的常见失败。
  if (
    mime === 'audio/wav' &&
    data.length >= 12 &&
    new TextDecoder().decode(data.subarray(0, 4)) === 'RIFF'
  ) {
    const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true)
    if (length !== 0xffffffff && length + 8 > data.length)
      throw new ProviderError('unknown', 'DeepSeek WAV 音频被截断；请勿自动重新提交', {
        outcome: 'unknown',
      })
  }
  return {
    outputs: [
      {
        type: 'file',
        kind: 'audio',
        mime,
        data,
        name: `speech.${options.format ?? 'wav'}`,
      } satisfies ProviderOutput,
    ],
  }
}

/** WebSocket 需要保留 text/binary 帧类型；core 的二进制 socket 契约不足以表达。 */
export interface DeepseekTtsSocket {
  sendText(text: string): void | Promise<void>
  receive(): Promise<string | Uint8Array>
  close(): void
}
export type DeepseekTtsConnect = (
  url: string,
  headers: Record<string, string>,
) => Promise<DeepseekTtsSocket>
export interface StreamingTtsOptions {
  voice_id?: 'stella' | 'tide'
  format?: 'pcm' | 'opus'
  filter_markdown?: boolean
}

/** 发送增量文本并逐帧消费音频；只有服务端 finish/success 才代表完成。 */
export async function* streamTts(
  ctx: AdapterContext,
  chunks: AsyncIterable<string> | Iterable<string>,
  connect: DeepseekTtsConnect,
  options: StreamingTtsOptions = {},
): AsyncGenerator<Uint8Array> {
  if (ctx.signal.aborted) throw new ProviderError('cancelled', 'DeepSeek TTS 已取消')
  const url = new URL(`${baseUrl(ctx)}/v1/tools/tts`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [name, value] of Object.entries(options)) url.searchParams.set(name, String(value))
  const socket = await connect(url.toString(), { Authorization: `Bearer ${apiKey(ctx)}` })
  if (ctx.signal.aborted) {
    socket.close()
    throw new ProviderError('cancelled', 'DeepSeek TTS 已取消')
  }
  const abort = () => socket.close()
  ctx.signal.addEventListener('abort', abort, { once: true })
  let sendingError: unknown
  const sending = (async () => {
    try {
      for await (const text of chunks) {
        if (ctx.signal.aborted) throw new ProviderError('cancelled', 'DeepSeek TTS 已取消')
        if (text) await socket.sendText(JSON.stringify({ event: 'text', text }))
      }
      await socket.sendText(JSON.stringify({ event: 'finish_text' }))
    } catch (error) {
      sendingError = error
      socket.close()
    }
  })()
  try {
    while (true) {
      if (sendingError) throw sendingError
      const frame = await socket.receive()
      if (ctx.signal.aborted) throw new ProviderError('cancelled', 'DeepSeek TTS 已取消')
      if (typeof frame !== 'string') {
        yield frame
        continue
      }
      const finish = JSON.parse(frame) as { event?: string; code?: string }
      if (finish.event !== 'finish') continue
      if (finish.code !== 'success')
        throw new ProviderError(
          finish.code === 'content_filter' ? 'content_policy' : 'unavailable',
          `DeepSeek TTS 失败：${finish.code ?? 'unknown'}`,
          { retryable: false },
        )
      await sending
      if (sendingError) throw sendingError
      return
    }
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause
    throw new ProviderError(
      ctx.signal.aborted ? 'cancelled' : 'unavailable',
      'DeepSeek TTS 未收到成功结束帧；请勿自动重新提交',
      { cause, outcome: 'unknown', retryable: false },
    )
  } finally {
    ctx.signal.removeEventListener('abort', abort)
    socket.close()
    void sending
  }
}
