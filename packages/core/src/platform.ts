/**
 * 平台自描述：每个平台包导出一个 `PlatformDescriptor`，汇总入口、MCP、CLI
 * 都只遍历注册表里的描述对象，不再各自维护平台清单、密钥名或工具目录。
 *
 * 新增平台时只需要写一个平台包，再把它的描述对象加进 `modelbay` 的注册表。
 */
import type { PlatformAdapter } from './adapter'
import type { ModelParamKind } from './model-limits'

/** 平台需要的密钥与配置项，只记名字，SDK 不存储值。 */
export interface PlatformSecrets {
  /**
   * 必填密钥，外层是「任选其一」的几组，内层同一组的名字要全部配置。
   * 例如豆包语音：`[['DOUBAO_API_KEY'], ['DOUBAO_APP_ID', 'DOUBAO_ACCESS_TOKEN']]`。
   */
  required: readonly (readonly string[])[]
  /** 可选配置：缺了照样能用，只是个别能力不可用（例如方舟的参考视频存储）。 */
  optional?: readonly string[]
  /** 规范名 → 也接受的别名（上游文档里的官方名、旧名）。 */
  aliases?: Readonly<Record<string, readonly string[]>>
}

/** JSON Schema 片段（MCP 工具的输入输出）。 */
export interface ToolSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, Record<string, unknown>>
  required?: string[]
  [key: string]: unknown
}

/** MCP 工具的操作性质：决定 annotations（只读 / 破坏性 / 幂等 / 联网）。缺省 `generate`。 */
export type ToolNature = 'generate' | 'query' | 'mutate' | 'local' | 'realtime'

/** MCP 工具组：默认只暴露 `core`，其余组由 `MODELBAY_MCP_GROUPS` 打开。缺省 `core`。 */
export type ToolGroup = 'core' | 'realtime' | 'management' | 'node'

/**
 * 一条 MCP 工具定义：只写与模型无关的平台特有部分（字段形状、平台开关、参数说明）。
 * 可选模型、默认值、上下限、生命周期提示由 `@modelbay/mcp` 在运行时从声明派生。
 */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: ToolSchema
  outputSchema?: ToolSchema
  /** 哪些参数随模型变化，以及它们对应声明里的哪一项上限。 */
  modelParams?: Record<string, ModelParamKind>
  /** 该工具对应的归一化能力；用于挑选声明和路由。缺省按工具名的通用约定推断。 */
  capability?: string
  /** 平台独有能力：调用 `adapter.native(op, params)`，而不是按能力 submit。 */
  native?: string
  /** 操作性质；缺省按通用工具名约定，再缺省为 `generate`。 */
  nature?: ToolNature
  /** 工具组；缺省按通用工具名约定，再缺省为 `core`。 */
  group?: ToolGroup
  /**
   * MCP 参数 → 适配器输入（submit）或 native 参数的平台专属换算。
   * 收到的参数已去掉 null；`model` 是解析后的渠道内模型 ID（native 路由时为空串）。
   * 通用换算（messages、素材、`wait`、`out_dir` 等）在之后由 `@modelbay/mcp` 处理。
   */
  mapArguments?(args: Record<string, unknown>, context: { model: string }): Record<string, unknown>
}

/** 一个平台的完整自描述。 */
export interface PlatformDescriptor<Options extends object = object> {
  /** 平台键，也是包名后缀、MCP 命令参数：`ark`、`bailian`… */
  key: string
  title: string
  /** 未指定模型时，默认模型在哪个渠道里选。 */
  primaryChannel: string
  secrets: PlatformSecrets
  /**
   * 创建本平台的全部适配器（一个平台可以有多个渠道 / 适配器）。
   * `options` 是 `@modelbay/<平台>/node` 导出的 `nodeOptions`，注入 Node 专属能力；
   * 不传时得到运行时无关的适配器。
   */
  createAdapters(options?: Options): PlatformAdapter[]
  /** MCP 工具目录；没有的平台不生成 MCP 服务。 */
  mcp?: { tools: readonly ToolSpec[] }
}

/** 定义平台描述对象（只做类型约束）。 */
export function definePlatform<Options extends object>(
  descriptor: PlatformDescriptor<Options>,
): PlatformDescriptor<Options> {
  return descriptor
}

function namesOf(spec: PlatformSecrets, name: string): readonly string[] {
  return [name, ...(spec.aliases?.[name] ?? [])]
}

/** 平台用到的全部环境变量名（必填、可选及其别名），用于从环境里读取。 */
export function secretEnvNames(spec: PlatformSecrets): string[] {
  const names = [...spec.required.flat(), ...(spec.optional ?? [])]
  return [...new Set(names.flatMap((name) => namesOf(spec, name)))]
}

/** 从环境（或任意键值表）里取出平台用得到的密钥。 */
export function readSecrets(
  spec: PlatformSecrets,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const name of secretEnvNames(spec)) {
    const value = env[name]?.trim()
    if (value) secrets[name] = value
  }
  return secrets
}

/**
 * 还缺哪些必填密钥：任意一组配齐就返回空数组；否则返回最接近配齐的那一组
 * （已配置的名字最多，平局取靠前的）里缺的规范名。只报告名字，不读取或返回值。
 */
export function missingSecrets(spec: PlatformSecrets, has: (name: string) => boolean): string[] {
  const present = (name: string) => namesOf(spec, name).some(has)
  let best: string[] | undefined
  let bestPresent = -1
  for (const group of spec.required) {
    const missing = group.filter((name) => !present(name))
    if (missing.length === 0) return []
    const count = group.length - missing.length
    if (count > bestPresent) {
      best = missing
      bestPresent = count
    }
  }
  return best ?? []
}
