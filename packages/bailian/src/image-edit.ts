/**
 * 局部重绘与精修的公共类型（运行时无关）。
 *
 * 这两项能力都要先用 sharp 预处理蒙版、再把图片传到百炼的临时 OSS，
 * 所以真正的实现在 Node 子路径 `@modelbay/bailian/node` 里；
 * 根入口只声明注入点、校验参数、发请求。
 */
import type { AdapterContext, AssetRef, LoadedFile } from '@modelbay/core'
import type { Json } from './http'

/** 局部重绘（`image.edit`）的请求体构造。 */
export type ImageEditPreparer = (
  ctx: AdapterContext,
  opts: {
    model: string
    prompt: string
    /** 基准图。 */
    image: AssetRef
    /** 蒙版；白色区域重绘。 */
    mask: AssetRef
    count?: number
    seed?: number
    extra?: Json
  },
) => Promise<Json>

/** 精修（`image.process`）的请求体构造：AI 放大或扩图。 */
export type ImageProcessPreparer = (
  ctx: AdapterContext,
  opts: {
    model: string
    /** 原图。 */
    image: AssetRef
    operation: 'upscale' | 'outpaint'
    prompt?: string
    /** 放大倍数。 */
    scale?: number
    /** 扩图各边的比例。 */
    expansion?: { top: number; bottom: number; left: number; right: number }
    /** 适配器已读过的原图（带媒体元数据），上传时不再重复读取。 */
    source?: LoadedFile
    extra?: Json
  },
) => Promise<Json>
