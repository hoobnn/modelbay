/** 各平台命令的元数据：环境变量、适配器导出、盘点文件。纯数据，无 core 依赖。 */
import type { PlatformKey } from './types'

export interface PlatformMeta {
  key: PlatformKey
  /** 命令名（package.json bin）。 */
  command: string
  /** 适配器 id（PlatformAdapter.id），用于日志与 initialize 的 serverInfo。 */
  adapterId: string
  title: string
  channels: string[]
  /**
   * 主渠道：工具的 model 默认值只在这个渠道里选。
   * 方舟 MCP 同时服务按量与套餐两个渠道，默认必须落在按量渠道，
   * 否则只有按量 key 的用户会被打到套餐接口上。
   */
  primaryChannel: string
  /** 盘点基线文件（测试逐个对照用）。 */
  inventoryFile: string
  /** createAdapterContext 需要的 key 环境变量名；缺任意一个即视为未配置。 */
  keyEnvVars: readonly string[]
  /** 适配器包导出的符号名（launch.ts 动态 import 后按名查找）。 */
  adapterExport: string
  /**
   * Node 子路径里的 native 实现。
   *
   * 有些 native 操作要连 WebSocket / 用 Node 专属依赖，根入口保持运行时无关，
   * 实现放在子路径里，由 launch.ts 加载后注入适配器。
   */
  nodeNatives?: NodeNativeSpec[]
}

/** 一个 Node 子路径里的 native 实现。 */
export interface NodeNativeSpec {
  /** 包内的子路径（不含 `./`） */
  subpath: string
  /** 子路径里导出的实现函数名 */
  export: string
  /** 传给适配器工厂的选项名 */
  option: string
  /** 包里导出适配器工厂的名字 */
  factory: string
}

/** 迁移顺序按 goals.md：方舟 → MiniMax → 百炼 → 豆包语音。 */
export const PLATFORMS: Record<PlatformKey, PlatformMeta> = {
  ark: {
    key: 'ark',
    command: 'modelbay-ark-mcp',
    adapterId: 'volc/ark',
    title: 'Volcengine Ark',
    channels: ['ark', 'ark-plan'],
    primaryChannel: 'ark',
    inventoryFile: 'mcp-volcengine-ark.json',
    keyEnvVars: ['ARK_API_KEY'],
    adapterExport: 'arkAdapter',
  },
  minimax: {
    key: 'minimax',
    command: 'modelbay-minimax-mcp',
    adapterId: 'minimax/minimax',
    title: 'MiniMax',
    channels: ['minimax'],
    primaryChannel: 'minimax',
    inventoryFile: 'mcp-minimax.json',
    keyEnvVars: ['MINIMAX_API_KEY'],
    adapterExport: 'minimaxAdapter',
  },
  bailian: {
    key: 'bailian',
    command: 'modelbay-bailian-mcp',
    adapterId: 'ali/bailian',
    title: 'Alibaba Bailian',
    channels: ['bailian'],
    primaryChannel: 'bailian',
    inventoryFile: 'mcp-ali-bailian.json',
    keyEnvVars: ['BAILIAN_API_KEY'],
    adapterExport: 'bailianAdapter',
  },
  'doubao-speech': {
    key: 'doubao-speech',
    command: 'modelbay-doubao-speech-mcp',
    adapterId: 'volc/doubao-speech',
    title: 'Doubao Speech',
    channels: ['doubao-speech'],
    primaryChannel: 'doubao-speech',
    inventoryFile: 'mcp-doubao-speech.json',
    keyEnvVars: ['DOUBAO_APP_ID', 'DOUBAO_ACCESS_TOKEN'],
    adapterExport: 'doubaoAdapter',
    nodeNatives: [
      {
        subpath: 'interpretation',
        export: 'interpretAudio',
        option: 'interpretation',
        factory: 'createDoubaoAdapter',
      },
      {
        subpath: 'asr',
        export: 'runAsrStream',
        option: 'asr',
        factory: 'createDoubaoAdapter',
      },
    ],
  },
}

/** 从环境变量名解析 group 开关：MODELBAY_MCP_GROUPS=core,realtime,node */
export const GROUP_ENV_VAR = 'MODELBAY_MCP_GROUPS'
