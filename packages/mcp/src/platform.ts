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
  /** 盘点基线文件（测试逐个对照用）。 */
  inventoryFile: string
  /** createAdapterContext 需要的 key 环境变量名；缺任意一个即视为未配置。 */
  keyEnvVars: readonly string[]
  /** 适配器包导出的符号名（launch.ts 动态 import 后按名查找）。 */
  adapterExport: string
}

/** 迁移顺序按 goals.md：方舟 → MiniMax → 百炼 → 豆包语音。 */
export const PLATFORMS: Record<PlatformKey, PlatformMeta> = {
  ark: {
    key: 'ark',
    command: 'modelbay-ark-mcp',
    adapterId: 'volc/ark',
    title: 'Volcengine Ark',
    channels: ['ark', 'ark-plan'],
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
    inventoryFile: 'mcp-doubao-speech.json',
    keyEnvVars: ['DOUBAO_APP_ID', 'DOUBAO_ACCESS_TOKEN'],
    adapterExport: 'doubaoSpeechAdapter',
  },
}

/** 从环境变量名解析 group 开关：MODELBAY_MCP_GROUPS=core,realtime,node */
export const GROUP_ENV_VAR = 'MODELBAY_MCP_GROUPS'
