/**
 * 百炼 Token Plan 渠道（`bailian-plan`）：套餐专用 API Key 与 Base URL，只接文本对话。
 *
 * 请求、流式和错误归类都复用按量渠道的对话实现，只把 Key 换成套餐 Key、域名换成套餐域名。
 * 套餐条款限定在 AI 编程 / 智能体工具里交互式使用，套餐模型在声明里标了 agentOnly，由宿主把关。
 * 2026-11-11 核对：https://help.aliyun.com/zh/model-studio/more-tools （OpenAI 兼容地址
 * `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`）、
 * https://help.aliyun.com/zh/model-studio/qwen4-max-preview
 */
import {
  defineAdapter,
  ProviderError,
  resolveModel,
  type AdapterContext,
  type ModelDeclaration,
  type PlatformAdapter,
} from '@modelbay/core'
import { createBailianAdapter, type BailianAdapterOptions } from './adapter'
import { API_KEY_NAMES } from './http'

export const PLAN_CHANNEL = 'bailian-plan'
export const PLAN_API_KEY = 'BAILIAN_TOKEN_PLAN_API_KEY'
export const PLAN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com'

const BASE_URL_NAMES = new Set(['BAILIAN_BASE_URL', 'DASHSCOPE_BASE_URL'])

/** 把按量渠道读的 Key / 域名换成套餐的；其余设置照旧。 */
function planContext(ctx: AdapterContext): AdapterContext {
  const key = ctx.secret(PLAN_API_KEY)?.trim()
  if (!key) throw new ProviderError('auth', `请先配置 ${PLAN_API_KEY}`)
  return {
    ...ctx,
    secret: (name) =>
      (API_KEY_NAMES as readonly string[]).includes(name)
        ? key
        : BASE_URL_NAMES.has(name)
          ? PLAN_BASE_URL
          : ctx.secret(name),
  }
}

export function createBailianPlanAdapter(
  models: ModelDeclaration[],
  options: BailianAdapterOptions = {},
): PlatformAdapter {
  const planModels = models.filter((model) =>
    model.channels.some((ref) => ref.channel === PLAN_CHANNEL),
  )
  // 内层复用按量渠道的实现：只认 bailian 渠道，所以把套餐渠道的 ID 映射到 bailian 名下
  const inner = createBailianAdapter(
    planModels.map((model) => ({
      ...model,
      channels: model.channels
        .filter((ref) => ref.channel === PLAN_CHANNEL)
        .map((ref) => ({ ...ref, channel: 'bailian' })),
    })),
    options,
  )
  return defineAdapter({
    id: 'aliyun/bailian-plan',
    title: '阿里云百炼 Token Plan',
    channels: [PLAN_CHANNEL],
    models: planModels,
    nativeOperations: [],
    docsUrl: 'https://help.aliyun.com/zh/model-studio/token-plan-overview',
    async submit(request, ctx) {
      if (request.capability !== 'text.chat')
        throw new ProviderError('invalid_input', `百炼 Token Plan 渠道只接文本对话`)
      const bare = request.model.startsWith(`${PLAN_CHANNEL}:`)
        ? request.model.slice(PLAN_CHANNEL.length + 1)
        : request.model
      const resolved = resolveModel(planModels, `${PLAN_CHANNEL}:${bare}`)
      if (!resolved)
        throw new ProviderError('invalid_input', `${request.model} 不在百炼 Token Plan 套餐内`)
      return inner.submit({ ...request, model: resolved.channel.id }, planContext(ctx))
    },
  })
}
