import {
  defineAdapter,
  ProviderError,
  resolveModel,
  type AdapterRequest,
  type ModelDeclaration,
  type PlatformAdapter,
  type ProviderOutput,
} from '@modelbay/core'
import { asJson } from '@modelbay/shared'
import { chat } from './chat'
import { all } from './models/index'
import { nativeOperations, runNative } from './native'

export function createDeepseekAdapter(declarations: ModelDeclaration[] = all): PlatformAdapter {
  return defineAdapter({
    id: 'deepseek/api',
    title: 'DeepSeek',
    channels: ['deepseek'],
    models: declarations,
    docsUrl: 'https://api-docs.deepseek.com/',
    nativeOperations,
    native: runNative,
    async submit(request, ctx) {
      if (request.native) {
        const value = await runNative(request.native.op, request.native.params, ctx)
        const outputs = asJson(value).outputs
        return {
          state: 'succeeded',
          outputs: Array.isArray(outputs)
            ? (outputs as ProviderOutput[])
            : [{ type: 'json', value }],
        }
      }
      const resolved = resolveModel(declarations, request.model)
      if (!resolved || request.capability !== 'text.chat')
        throw new ProviderError('invalid_input', 'DeepSeek 模型与能力不匹配')
      if (resolved.declaration.lifecycle.status === 'retired')
        throw new ProviderError('unavailable', 'DeepSeek 模型已归档')
      return chat(
        { ...request, model: resolved.channel.id } as AdapterRequest<'text.chat'>,
        ctx,
        resolved.declaration,
      )
    },
  })
}
