/**
 * Node-only PCM 读取：本地 WAV 或裸 PCM 文件。
 *
 * WAV 的容器头会被剥掉，线上传的是 PCM 本身；同传与流式识别共用这一份实现。
 */
import { readFileSync } from 'node:fs'
import { ProviderError } from '@modelbay/core'

/** 读到的音频：16bit PCM 与它的参数。 */
export interface PcmAudio {
  data: Uint8Array
  rate: number
  bits: number
  channel: number
}

/**
 * 读本地 WAV 或裸 PCM。
 *
 * WAV 的容器头会被剥掉：线上传的是 PCM 本身。
 */
export function readPcm(path: string): PcmAudio {
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch (cause) {
    throw new ProviderError('invalid_input', `无法读取音频文件：${path}`, { cause })
  }
  const lower = path.toLowerCase()
  if (lower.endsWith('.pcm')) {
    return { data: new Uint8Array(raw), rate: 16000, bits: 16, channel: 1 }
  }
  if (!lower.endsWith('.wav')) {
    throw new ProviderError('invalid_input', '只支持本地 .wav 或 .pcm 文件')
  }
  if (
    raw.length < 44 ||
    raw.toString('ascii', 0, 4) !== 'RIFF' ||
    raw.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new ProviderError('invalid_input', '不是合法的 WAV 文件')
  }
  const channel = raw.readUInt16LE(22)
  const rate = raw.readUInt32LE(24)
  const bits = raw.readUInt16LE(34)
  let offset = 12
  while (offset + 8 <= raw.length) {
    const id = raw.toString('ascii', offset, offset + 4)
    const size = raw.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'data') {
      return { data: new Uint8Array(raw.subarray(start, start + size)), rate, bits, channel }
    }
    offset = start + size + (size % 2)
  }
  throw new ProviderError('invalid_input', 'WAV 里没有 data 段')
}
