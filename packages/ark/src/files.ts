/**
 * 素材读取：宿主给了 `ctx.files`（带时长 / 宽高 / 编码的元数据）就用它；
 * 只有 `ctx.assets`（MCP / CLI 的素材库）时退回字节读取，此时没有元数据可校验。
 */
import { ProviderError, type AdapterContext, type AssetRef, type LoadedFile } from '@modelbay/core'
import { imageDataUrl as sharedImageDataUrl, type ImageRule } from '@modelbay/shared'

/** 方舟图片参考 / 首尾帧 / 对话图片的格式与大小要求（须小于 30 MB）。 */
export const IMAGE_RULE: ImageRule = {
  notImage: '火山方舟此输入仅支持图片参考；本地视频 / 音频参考需预先上传至平台素材库',
  accept: (mime) => /^image\/(jpeg|png|webp|bmp|tiff|gif|heic|heif)$/.test(mime),
  badMime: '参考图片 MIME 格式不受火山方舟支持',
  maxBytes: 30 * 1024 * 1024 - 1,
  tooLarge: '参考图片必须非空且小于 30 MB',
}

/** 宿主是否提供了带元数据的文件读取（决定素材校验是否按 strict 执行）。 */
export function hasFiles(ctx: Pick<AdapterContext, 'files'>): boolean {
  return Boolean(ctx.files)
}

/** 读一份素材；两种来源都没有时报 invalid_input。 */
export async function readFile(
  ctx: Pick<AdapterContext, 'files' | 'assets'>,
  ref: AssetRef,
): Promise<LoadedFile> {
  if (ctx.files) return ctx.files.read(ref)
  if (!ctx.assets)
    throw new ProviderError('invalid_input', '火山方舟需要宿主注入 files 或 assets 才能读取素材')
  const asset = await ctx.assets.load(ref.assetId)
  return { data: asset.data, mime: asset.mime || ref.mime || 'application/octet-stream' }
}

/**
 * 参考图 / 首尾帧 / 对话图片 → base64 data URL。
 *
 * `files` 路径与宿主完全一致（格式白名单、30 MB 以内、非空）；
 * 只有 `assets` 时没有可比对的元数据，沿用字节读取。
 */
export async function imageData(
  ctx: Pick<AdapterContext, 'files' | 'assets'>,
  ref: AssetRef,
): Promise<string> {
  if (ctx.files) return sharedImageDataUrl(ctx, ref, IMAGE_RULE)
  if (!ctx.assets)
    throw new ProviderError('invalid_input', '火山方舟 需要宿主注入 assets 才能发送图片')
  const file = await readFile(ctx, ref)
  return sharedImageDataUrl({ files: { read: async () => file } }, ref, IMAGE_RULE)
}
