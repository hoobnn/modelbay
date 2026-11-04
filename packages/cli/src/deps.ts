/**
 * `@modelbay/cli` 与 `modelbay` SDK 之间的适配层。
 *
 * 这里只声明 SDK 汇总入口在 CLI 侧真正用到的部分，并把它转成命令层要的
 * 数据源。类型全部来自 `modelbay` 的类型导出，运行时不会加载 SDK，
 * 所以这一层可以用假实现直接测。
 */
import type { Capability, CapabilityInput } from 'modelbay'
import type {
  CliDeclaration,
  CliDeps,
  CliDoctorReport,
  CliGenerateRequest,
  CliOutcome,
} from './commands'

/** SDK 汇总入口在 CLI 侧用到的最小接口。 */
export interface CliSdk {
  registry: { all(): readonly CliDeclaration[] }
  capabilities(): readonly string[]
  doctor(): CliDoctorReport
  generate(request: {
    capability: Capability
    model?: string
    input: CapabilityInput<Capability>
    signal?: AbortSignal
  }): Promise<CliOutcome>
}

/** 把 SDK 汇总入口适配成命令层需要的数据源。 */
export function createCliDeps(sdk: CliSdk): CliDeps {
  return {
    models: () => sdk.registry.all(),
    capabilities: () => sdk.capabilities(),
    doctor: () => sdk.doctor(),
    generate: (request: CliGenerateRequest) =>
      sdk.generate({
        capability: request.capability as Capability,
        ...(request.model ? { model: request.model } : {}),
        input: request.input as CapabilityInput<Capability>,
        ...(request.signal ? { signal: request.signal } : {}),
      }),
  }
}
