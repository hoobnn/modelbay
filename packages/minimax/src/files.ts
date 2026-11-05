/**
 * 素材读取：宿主给了 `ctx.files`（带媒体元数据）就直接用；
 * 只有 `ctx.assets`（MCP / CLI）时按 assetId 读取，元数据缺省，由下游按声明处理。
 */
import type { AdapterContext } from '@modelbay/core'

export type FilesContext = AdapterContext & Required<Pick<AdapterContext, 'files'>>

export function withFiles(ctx: AdapterContext): AdapterContext {
  if (ctx.files || !ctx.assets) return ctx
  const assets = ctx.assets
  return {
    ...ctx,
    files: {
      read: async (ref) => {
        const loaded = await assets.load(ref.assetId)
        return { data: loaded.data, mime: ref.mime ?? loaded.mime }
      },
    },
  }
}
