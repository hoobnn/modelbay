/**
 * Node-only Bailian image editing (`@modelbay/bailian/image-edit`).
 *
 * This subpath is intentionally excluded from the root entry: the host-side `sharp`
 * mask preprocessing and the OSS multi-part upload are Node-specific. The request
 * builder below is runtime-agnostic; the actual preprocessing/upload is a documented
 * TODO (see the package README).
 */
import { ProviderError } from '@modelbay/core'

export const IMAGE_EDIT_PATH = '/api/v1/services/aigc/image2image/image-synthesis'

export interface ImageEditOptions {
  model?: string
  prompt: string
  /** Public URL or `oss://` address produced by the Node-only uploader. */
  baseImageUrl: string
  /** PNG mask, same dimensions as the source; white = repaint. */
  maskImageUrl: string
  count?: number
  seed?: number
  extra?: Record<string, unknown>
}

/** Build the `description_edit_with_mask` request body (no `node:` imports here). */
export function buildImageEditRequest(opts: ImageEditOptions): Record<string, unknown> {
  if (!opts.prompt.trim()) throw new ProviderError('invalid_input', 'Image edit prompt is required')
  if (!opts.baseImageUrl || !opts.maskImageUrl)
    throw new ProviderError('invalid_input', 'base_image_url and mask_image_url are required')
  return {
    model: opts.model ?? 'wanx2.1-imageedit',
    input: {
      function: 'description_edit_with_mask',
      prompt: opts.prompt,
      base_image_url: opts.baseImageUrl,
      mask_image_url: opts.maskImageUrl,
    },
    parameters: {
      ...opts.extra,
      n: opts.count ?? 1,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    },
  }
}

/**
 * TODO: implement `sharp`-based mask normalization and the Node-only OSS upload.
 * Kept as an explicit marker so consumers get a clear error instead of a silent no-op.
 */
export function imageEditNodeOnly(): never {
  throw new ProviderError(
    'unavailable',
    'Node-only image editing is not implemented yet; use buildImageEditRequest with your own uploader',
  )
}
