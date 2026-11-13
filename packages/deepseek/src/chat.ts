/** DeepSeek Chat Completions: shared SSE parsing, tools and reasoning replay. */
import {
  ProviderError,
  toBase64,
  type AdapterContext,
  type AdapterRequest,
  type AssetRef,
  type ModelDeclaration,
  type SubmitResult,
} from '@modelbay/core'
import { asJson, chatCompletion, requireSseDone } from '@modelbay/shared'
import { z } from 'zod'
import { baseUrl, errorInfo, sendRequest } from './http'
import { responsesChat } from './chat-responses'

function invalid(message: string): never {
  throw new ProviderError('invalid_input', message)
}

/** Assets are always read through host ports, never by an unrestricted fetch. */
export async function imageUrl(ctx: AdapterContext, ref: AssetRef): Promise<string> {
  if (ref.kind !== 'image') invalid('DeepSeek 只接受图片资产')
  const file = ctx.files
    ? await ctx.files.read(ref)
    : ctx.assets
      ? await ctx.assets.load(ref.assetId)
      : invalid('DeepSeek 图片输入需要宿主提供 files 或 assets')
  const mime = file.mime.toLowerCase()
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime))
    invalid('DeepSeek 图片须为 PNG、JPEG、WebP 或 GIF')
  if (!file.data.length) invalid('DeepSeek 图片不能为空')
  return `data:${mime};base64,${toBase64(file.data)}`
}

export async function chat(
  request: AdapterRequest<'text.chat'>,
  ctx: AdapterContext,
  model: ModelDeclaration,
): Promise<SubmitResult> {
  const { input } = request
  if (!input.messages.length) invalid('对话至少需要一条消息')
  const extra = { ...input.extra }
  // Model-specific options and ranges belong to the declaration.
  const properties = asJson(model.optionsSchema?.properties)
  for (const key of Object.keys(extra))
    if (!(key in properties)) invalid(`DeepSeek 不支持 extra.${key}`)
  if (model.optionsSchema) {
    const parsed = z.fromJSONSchema(model.optionsSchema).safeParse(extra)
    if (!parsed.success) invalid(`DeepSeek 参数不符合模型声明：${parsed.error.message}`)
  }
  if (!model.features?.includes('vision'))
    for (const message of input.messages)
      if (Array.isArray(message.content) && message.content.some((p) => p.type === 'image'))
        invalid('当前 DeepSeek 模型不支持图片输入')
  if (extra.web_history !== undefined)
    invalid('联网多轮历史请使用 native responses 原样回传完整 input 和 output')
  if (
    extra.api === 'responses' ||
    extra.web_search ||
    extra.read_url ||
    extra.title ||
    extra.safety_check
  )
    return responsesChat(request, ctx, model)
  delete extra.api
  delete extra.web_search
  delete extra.read_url
  delete extra.web_history
  if (extra.user !== undefined) {
    extra.user_id = extra.user
    delete extra.user
  }
  return chatCompletion({
    ctx,
    label: 'DeepSeek',
    model: request.model,
    input: { ...input, extra },
    baseURL: baseUrl(ctx),
    replayReasoning: true,
    structured: 'json_object',
    image: (ref) => imageUrl(ctx, ref),
    streamError: (error) => errorInfo(error, 200, ctx),
    fetch: async (_url, init) => {
      // The compatible SDK consumes some options (notably reasoning_effort) as
      // controlled settings. Replay our validated wire fields after its conversion.
      const body = { ...asJson(JSON.parse(String(init?.body))), ...extra }
      const res = await sendRequest(ctx, '/chat/completions', 'POST', JSON.stringify(body), {
        'Content-Type': 'application/json',
      })
      return requireSseDone(
        res,
        () =>
          new ProviderError('unknown', 'DeepSeek 流式回答未完整结束；请勿自动重新提交', {
            outcome: 'unknown',
            retryable: false,
          }),
      )
    },
  })
}
