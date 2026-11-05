/** 共享包测试的小工具：SSE 响应、请求体读取、已中止信号与合成 WAV。 */
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- 常见的几种应答类型，便于阅读
export type Reply = Response | Error | unknown

/** text/event-stream 响应 */
export function sse(text: string) {
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** 第 index 次 fetch 调用的 JSON 请求体 */
export function requestBody(fetch: { mock: { calls: unknown[][] } }, index = 0) {
  const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

/** 已中止的 signal */
export function aborted(reason?: unknown) {
  const controller = new AbortController()
  controller.abort(reason)
  return controller.signal
}

/** 一小段合法的 PCM WAV（RIFF 头 + 正弦波），给试听嗅探测试用 */
export function sineWav(seconds: number, frequency = 440, sampleRate = 16000): Uint8Array {
  const samples = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVEfmt ', 8, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // 单声道
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000),
      44 + i * 2,
    )
  }
  return new Uint8Array(buf)
}
