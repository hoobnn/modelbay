import type { PortValue } from './ports'

/**
 * 参考素材在最终提示词里的编号写法。
 *
 * 服务端、面板与提示词正文共用这一份规则：图片节点写「图N」，
 * MiniMax 视频写「图片N / 视频N / 音频N」，
 * 方舟 Seedance 写「@图片N / @视频N / @音频N」，
 * 百炼万相 3.0 写「图N / 视频N / 音频N」（官方示例不带 @），
 * 其余视频写「@imageN」。
 * 编号从 1 开始，图片、视频、音频各自按实际送入模型的顺序排列。
 * 写法里不带「参考」二字：编辑、延长任务的官方要求是写「视频1」而不是「参考视频1」。
 */
export type ReferenceLabelStyle =
  | 'image'
  | 'minimax-video'
  | 'ark-video'
  | 'bailian-video'
  | 'video'
export type ReferenceMediaKind = 'image' | 'video' | 'audio'

/** 按节点能力与模型厂商决定编号写法；非参考模式不编号。 */
export function referenceLabelStyle(
  capability: string | undefined,
  provider: string | undefined,
): ReferenceLabelStyle {
  if (capability === 'image.generate') return 'image'
  if (provider === 'minimax/api') return 'minimax-video'
  if (provider === 'volc/ark' || provider === 'volc/ark-plan') return 'ark-video'
  if (provider === 'aliyun/bailian') return 'bailian-video'
  return 'video'
}

/** 第 index 张参考图在提示词正文里的编号（index 从 1 开始）。 */
export function referenceLabel(style: ReferenceLabelStyle, index: number): string {
  if (style === 'image') return `图${index}`
  if (style === 'minimax-video') return `图片${index}`
  if (style === 'ark-video') return `@图片${index}`
  if (style === 'bailian-video') return `图${index}`
  return `@image${index}`
}

/** 同类参考媒体的第 index 份在正文里的编号；视频 / 音频使用平台既有 token 约定。 */
export function referenceMediaLabel(
  style: ReferenceLabelStyle,
  kind: ReferenceMediaKind,
  index: number,
): string {
  if (kind === 'image') return referenceLabel(style, index)
  const name = kind === 'video' ? '视频' : '音频'
  if (style === 'minimax-video' || style === 'bailian-video') return `${name}${index}`
  if (style === 'ark-video') return `@${name}${index}`
  return `@${kind}${index}`
}

/** 图片、视频、音频各自按实际送入顺序编号；同一资产在同一类型里去重。 */
export function referenceMediaNumbering(style: ReferenceLabelStyle, values: readonly PortValue[]) {
  const indexes: Record<ReferenceMediaKind, Map<string, number>> = {
    image: new Map(),
    video: new Map(),
    audio: new Map(),
  }
  const counts: Record<ReferenceMediaKind, number> = { image: 0, video: 0, audio: 0 }
  for (const value of values) {
    if (
      (value.type !== 'image' && value.type !== 'video' && value.type !== 'audio') ||
      !('assetId' in value)
    )
      continue
    const kind = value.type
    counts[kind]++
    if (!indexes[kind].has(value.assetId)) indexes[kind].set(value.assetId, counts[kind])
  }
  return {
    index: (kind: ReferenceMediaKind, assetId: string) => indexes[kind].get(assetId),
    label: (kind: ReferenceMediaKind, assetId: string) => {
      const index = indexes[kind].get(assetId)
      return index === undefined ? undefined : referenceMediaLabel(style, kind, index)
    },
  }
}

/**
 * 一批送入模型的参考素材的编号表：资产 → 编号与写法。
 * 编号顺序就是最终提示词里的编号顺序，面板顶部列表与正文徽标都用它。
 */
export function referenceNumbering(
  style: ReferenceLabelStyle,
  images: readonly PortValue[],
): { index(assetId: string): number | undefined; label(assetId: string): string | undefined } {
  const indexes = new Map<string, number>()
  let count = 0
  for (const value of images) {
    if (value.type !== 'image' || !('assetId' in value)) continue
    count++
    if (!indexes.has(value.assetId)) indexes.set(value.assetId, count)
  }
  return {
    index: (assetId) => indexes.get(assetId),
    label: (assetId) => {
      const index = indexes.get(assetId)
      return index === undefined ? undefined : referenceLabel(style, index)
    },
  }
}
