/**
 * MCP 的素材来源：工具参数里的图片 / 音频 / 视频是本地路径、`file://`、`http(s)://` 或 `data:` URL，
 * 适配器按 `AssetRef.assetId` 读取时由这里取字节。没有这层，适配器拿不到任何输入素材。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProviderError } from '@modelbay/core'
import type { AssetSource, LoadedAsset } from '@modelbay/core'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.pcm': 'audio/pcm',
  '.amr': 'audio/amr',
}

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXT)
    .reverse()
    .map(([ext, mime]) => [mime, ext]),
)

/** 按扩展名猜 MIME；猜不出时返回 undefined。 */
export function mimeFromName(name: string): string | undefined {
  const path = name.split(/[?#]/)[0] ?? name
  return MIME_BY_EXT[extname(path).toLowerCase()]
}

/** 按 MIME 取常用扩展名（含点）；没有时返回空字符串。 */
export function extensionFor(mime: string): string {
  return EXT_BY_MIME[mime.split(';')[0]!.trim().toLowerCase()] ?? ''
}

function decodeDataUrl(ref: string): LoadedAsset {
  const match = /^data:([^;,]*)((?:;[^,]*)?),(.*)$/s.exec(ref)
  if (!match) throw new ProviderError('invalid_input', 'data URL 格式不正确')
  const mime = match[1] || 'application/octet-stream'
  const body = match[3] ?? ''
  const data = match[2]?.includes(';base64')
    ? Uint8Array.from(Buffer.from(body, 'base64'))
    : percentDecode(body)
  return { data, mime }
}

/** 百分号转义直接解成字节（二进制内容不一定是合法 UTF-8，不能走 decodeURIComponent）。 */
function percentDecode(body: string): Uint8Array {
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let i = 0; i < body.length;) {
    const hex = body[i] === '%' ? body.slice(i + 1, i + 3) : ''
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      i += 3
      continue
    }
    const char = String.fromCodePoint(body.codePointAt(i)!)
    bytes.push(...encoder.encode(char))
    i += char.length
  }
  return Uint8Array.from(bytes)
}

function localPath(ref: string, cwd: string): string {
  if (ref.startsWith('file://')) return fileURLToPath(ref)
  if (ref === '~' || ref.startsWith('~/')) return resolve(homedir(), ref.slice(2))
  return resolve(cwd, ref)
}

export interface McpAssetOptions {
  fetchImpl?: typeof fetch
  /** 相对路径的基准目录，缺省为进程当前目录 */
  cwd?: string
}

export function createMcpAssetSource(options: McpAssetOptions = {}): AssetSource {
  const fetchImpl = options.fetchImpl ?? fetch
  const cwd = options.cwd ?? process.cwd()
  return {
    async load(ref: string): Promise<LoadedAsset> {
      const value = ref.trim()
      if (!value) throw new ProviderError('invalid_input', '素材路径为空')
      if (value.startsWith('data:')) return decodeDataUrl(value)
      if (/^https?:\/\//i.test(value)) {
        const response = await fetchImpl(value)
        if (!response.ok)
          throw new ProviderError(
            'unavailable',
            `素材下载失败：HTTP ${response.status}（${value}）`,
          )
        const header = response.headers.get('content-type')?.split(';')[0]?.trim()
        const mime =
          header && header !== 'application/octet-stream'
            ? header
            : (mimeFromName(value) ?? 'application/octet-stream')
        return { data: new Uint8Array(await response.arrayBuffer()), mime, url: value }
      }
      const path = localPath(value, cwd)
      let data: Uint8Array
      try {
        data = new Uint8Array(await readFile(path))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        throw new ProviderError(
          'invalid_input',
          code === 'ENOENT' ? `找不到素材文件：${path}` : `读取素材文件失败：${path}`,
        )
      }
      return { data, mime: mimeFromName(path) ?? 'application/octet-stream' }
    },
  }
}
