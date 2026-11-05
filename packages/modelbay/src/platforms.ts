/**
 * 平台注册表：汇总入口、MCP、CLI 都从这里取平台清单。
 * 新增平台时，写好平台包后在这里加一行（有 Node 扩展的，再在 `node.ts` 加一行）。
 */
import type { PlatformDescriptor } from '@modelbay/core'
import { arkPlatform } from '@modelbay/ark'
import { bailianPlatform } from '@modelbay/bailian'
import { doubaoSpeechPlatform } from '@modelbay/doubao-speech'
import { minimaxPlatform } from '@modelbay/minimax'
import { openaiPlatform } from '@modelbay/openai'

export const PLATFORMS: readonly PlatformDescriptor[] = [
  arkPlatform,
  minimaxPlatform,
  bailianPlatform,
  doubaoSpeechPlatform,
  openaiPlatform,
]

/** 按平台键查描述对象。 */
export function findPlatform(key: string): PlatformDescriptor | undefined {
  return PLATFORMS.find((platform) => platform.key === key)
}
