/**
 * Node-only image-edit helpers, exported from `@modelbay/openai/node`.
 * The root entry never imports this file: the real mask inversion needs `sharp`,
 * which is Node-only and is installed by the integrator.
 */
import { ProviderError } from '@modelbay/core'

export interface MaskInput {
  data: Uint8Array
  mime: string
  width: number
  height: number
}

/** Original image and mask must have identical dimensions. */
export function assertSameSize(source: MaskInput, mask: MaskInput): void {
  if (source.width !== mask.width || source.height !== mask.height)
    throw new ProviderError('invalid_input', '蒙版与原图尺寸不一致')
}

/**
 * TODO(M3): convert plein's white=repaint mask into an RGBA alpha mask with
 * `sharp` (rotate → greyscale → invert brightness → joinChannel as alpha).
 * Until `sharp` is installed by the integrator this is a clear error; the root
 * `image.edit` path documents that the Node subpath is required.
 */
export function prepareEditMask(_source: MaskInput, _mask: MaskInput): never {
  throw new ProviderError(
    'unavailable',
    'TODO: 蒙版白→透明 alpha 转换需要 sharp，请在 Node 子路径接入后再用',
  )
}
