/** 独立工具及完整协议入口；来源：https://api-docs.deepseek.com/api/（2026-11-13）。 */
import { ProviderError, type AdapterContext, type AssetRef } from '@modelbay/core'
import { z } from 'zod'
import { requestJson, sendRequest, readJsonResponse } from './http'
import { synthesizeSpeech, type TtsOptions } from './speech'

const record = z.record(z.string(), z.unknown())
const purpose = z.enum(['user_data', 'text_recognition', 'rich_layout_recognition'])
const recognitionPurpose = z.enum(['text_recognition', 'rich_layout_recognition'])
const binaryInput = z.object({
  file: z.unknown(),
  filename: z.string().min(1),
  mime: z.string().optional(),
})
const ttsSchema = z
  .object({
    text: z.string().min(1),
    voice_id: z.enum(['stella', 'tide']).optional(),
    format: z.enum(['wav', 'pcm']).optional(),
    filter_markdown: z.boolean().optional(),
  })
  .strict()
const searchSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(128)
      .refine((s) => !!s.trim()),
    count: z.number().int().min(1).max(50).optional(),
    ori_question: z.string().min(1).max(128).nullable().optional(),
    localization: z.string().optional(),
    need_content: z.boolean().optional(),
  })
  .strict()
const fileIdSchema = z.string().regex(/^file-api-[A-Za-z0-9_-]+$/)
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new ProviderError('invalid_input', `DeepSeek 参数无效：${result.error.message}`)
  return result.data
}

/** SDK 接受 Blob、Uint8Array、AssetRef；MCP 可使用 base64 对象，无 Node 文件依赖。 */
export async function fileBlob(ctx: AdapterContext, file: unknown, mime?: string): Promise<Blob> {
  if (file instanceof Blob) return file
  if (file instanceof Uint8Array) return new Blob([new Uint8Array(file)], { type: mime })
  if (file && typeof file === 'object') {
    if ('base64' in file && typeof file.base64 === 'string') {
      try {
        const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))
        return new Blob([bytes], { type: mime })
      } catch {
        throw new ProviderError('invalid_input', 'file.base64 无效')
      }
    }
    if ('assetId' in file && typeof file.assetId === 'string') {
      const ref = file as AssetRef
      const loaded = ctx.files ? await ctx.files.read(ref) : await ctx.assets?.load(ref.assetId)
      if (loaded) return new Blob([new Uint8Array(loaded.data)], { type: loaded.mime })
    }
  }
  throw new ProviderError('invalid_input', 'file 需要 Blob、Uint8Array、AssetRef 或 { base64 }')
}

export function search(ctx: AdapterContext, params: Record<string, unknown>) {
  return requestJson(ctx, '/v1/tools/search', 'POST', parse(searchSchema, params))
}
export function fetchUrl(ctx: AdapterContext, params: Record<string, unknown>) {
  const body = parse(z.object({ url: z.string().min(1).max(8192) }).strict(), params)
  let url: URL
  try {
    url = new URL(body.url)
  } catch {
    throw new ProviderError('invalid_input', 'fetch url 无效')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new ProviderError('invalid_input', 'fetch url 必须为无凭据的 HTTP(S) 地址')
  return requestJson(ctx, '/v1/tools/fetch', 'POST', body)
}
export function listRemoteModels(ctx: AdapterContext) {
  return requestJson(ctx, '/models', 'GET')
}
export function userBalance(ctx: AdapterContext) {
  return requestJson(ctx, '/user/balance', 'GET')
}

export async function uploadFile(ctx: AdapterContext, params: Record<string, unknown>) {
  const input = parse(
    binaryInput
      .extend({
        purpose,
        expires_after: z
          .object({
            anchor: z.literal('created_at'),
            seconds: z.number().int().min(3600).max(2592000),
          })
          .strict()
          .optional(),
      })
      .strict(),
    params,
  )
  const form = new FormData()
  form.set('purpose', input.purpose)
  if (input.expires_after) {
    form.set('expires_after[anchor]', input.expires_after.anchor)
    form.set('expires_after[seconds]', String(input.expires_after.seconds))
  }
  form.set('file', await fileBlob(ctx, input.file, input.mime), input.filename)
  return readJsonResponse(ctx, await sendRequest(ctx, '/files', 'POST', form))
}
export function listFiles(ctx: AdapterContext, params: Record<string, unknown> = {}) {
  const values = parse(
    z
      .object({
        after: fileIdSchema.optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        purpose: purpose.optional(),
      })
      .strict(),
    params,
  )
  const query = new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, String(value)]),
  )
  return requestJson(ctx, `/files${query.size ? `?${query}` : ''}`, 'GET')
}
export function retrieveFile(ctx: AdapterContext, fileId: string) {
  return requestJson(ctx, `/files/${parse(fileIdSchema, fileId)}`, 'GET')
}
export function deleteFile(ctx: AdapterContext, fileId: string) {
  return requestJson(ctx, `/files/${parse(fileIdSchema, fileId)}`, 'DELETE')
}
export async function recognizeDocument(ctx: AdapterContext, params: Record<string, unknown>) {
  const input = parse(binaryInput.extend({ purpose: recognitionPurpose }).strict(), params)
  const form = new FormData()
  form.set('purpose', input.purpose)
  form.set('file', await fileBlob(ctx, input.file, input.mime), input.filename)
  return readJsonResponse(ctx, await sendRequest(ctx, '/v1/tools/ocr', 'POST', form))
}
export async function transcribeSpeech(ctx: AdapterContext, params: Record<string, unknown>) {
  const input = parse(binaryInput.strict(), params)
  const form = new FormData()
  form.set('file', await fileBlob(ctx, input.file, input.mime), input.filename)
  return readJsonResponse(ctx, await sendRequest(ctx, '/v1/tools/asr', 'POST', form))
}

export type DeepseekProtocol = 'responses' | 'messages' | 'fim' | 'chat-completions' | 'chat-prefix'

/** 完整协议的原始 Response 入口，包含 SSE；宿主负责读取并检查对应协议的成功终态。 */
export async function protocolResponse(
  ctx: AdapterContext,
  protocol: DeepseekProtocol,
  body: Record<string, unknown>,
): Promise<Response> {
  parse(record, body)
  const paths: Record<DeepseekProtocol, string> = {
    responses: '/responses',
    messages: '/anthropic/v1/messages',
    fim: '/beta/completions',
    'chat-completions': '/chat/completions',
    'chat-prefix': '/beta/chat/completions',
  }
  const last = Array.isArray(body.messages) ? body.messages.at(-1) : undefined
  // https://api-docs.deepseek.com/guides/chat_prefix_completion/（2026-11-13）
  const prefix =
    protocol === 'chat-completions' &&
    last &&
    typeof last === 'object' &&
    last.role === 'assistant' &&
    last.prefix === true
  const path = prefix ? paths['chat-prefix'] : paths[protocol]
  return sendRequest(ctx, path, 'POST', JSON.stringify(body), {
    'Content-Type': 'application/json',
    ...(protocol === 'messages' ? { 'anthropic-beta': 'files-api-2025-04-14' } : {}),
  })
}

/** JSON 原生协议保留所有返回字段；MCP 一次返回完整 JSON，不接受 SSE。 */
export async function protocolRequest(
  ctx: AdapterContext,
  protocol: DeepseekProtocol,
  body: Record<string, unknown>,
) {
  parse(record, body)
  if (body.stream !== undefined && body.stream !== null && body.stream !== false)
    throw new ProviderError(
      'invalid_input',
      '原生 JSON 入口不接受 stream=true；SDK 流式请使用 protocolResponse 或 text.chat',
    )
  return readJsonResponse(ctx, await protocolResponse(ctx, protocol, body))
}

export const nativeOperations = [
  'search',
  'fetch-url',
  'ocr',
  'tts',
  'asr',
  'upload-file',
  'list-files',
  'retrieve-file',
  'delete-file',
  'user-balance',
  'list-remote-models',
  'responses',
  'messages',
  'fim',
  'chat-completions',
  'raw-request',
]

export async function runNative(
  op: string,
  params: Record<string, unknown>,
  ctx: AdapterContext,
): Promise<unknown> {
  switch (op) {
    case 'search':
      return search(ctx, params)
    case 'fetch-url':
      return fetchUrl(ctx, params)
    case 'ocr':
      return recognizeDocument(ctx, params)
    case 'tts':
      return synthesizeSpeech(ctx, parse(ttsSchema, params) as TtsOptions)
    case 'asr':
      return transcribeSpeech(ctx, params)
    case 'upload-file':
      return uploadFile(ctx, params)
    case 'list-files':
      return listFiles(ctx, params)
    case 'retrieve-file':
      return retrieveFile(ctx, parse(z.object({ file_id: fileIdSchema }).strict(), params).file_id)
    case 'delete-file':
      return deleteFile(ctx, parse(z.object({ file_id: fileIdSchema }).strict(), params).file_id)
    case 'user-balance':
      return userBalance(ctx)
    case 'list-remote-models':
      return listRemoteModels(ctx)
    case 'responses':
    case 'messages':
    case 'fim':
    case 'chat-completions':
      return protocolRequest(ctx, op, parse(z.object({ body: record }).strict(), params).body)
    case 'raw-request': {
      const input = parse(
        z
          .object({
            path: z.enum([
              '/responses',
              '/anthropic/v1/messages',
              '/beta/completions',
              '/chat/completions',
              '/beta/chat/completions',
            ]),
            body: record,
          })
          .strict(),
        params,
      )
      const names = {
        '/responses': 'responses',
        '/anthropic/v1/messages': 'messages',
        '/beta/completions': 'fim',
        '/chat/completions': 'chat-completions',
        '/beta/chat/completions': 'chat-prefix',
      } as const
      return protocolRequest(ctx, names[input.path], input.body)
    }
    default:
      throw new ProviderError('invalid_input', `DeepSeek 不支持 native 操作 ${op}`)
  }
}
