import { z } from 'zod'

/** image-01 / image-01-live 的专属参数；与模型声明里的 optionsSchema 一致。 */
export const imageOptions = z.object({
  prompt_optimizer: z.boolean().optional(),
  aigc_watermark: z.boolean().optional(),
})

export const liveImageOptions = imageOptions
  .extend({
    style_type: z.enum(['漫画', '元气', '中世纪', '水彩']).optional(),
    style_weight: z.number().gt(0).max(1).optional(),
  })
  .refine((value) => value.style_weight === undefined || value.style_type !== undefined, {
    path: ['style_type'],
    message: '画风权重需要先选择画风',
  })
