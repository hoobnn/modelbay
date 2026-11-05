/**
 * CLI 的进程级装配：把 argv、输出通道和数据源接到命令层上。
 *
 * argv、IO 和 deps 都由调用方注入，所以这段逻辑（尤其是错误退出码）
 * 不用起子进程就能测。真正的 `process.*` 只出现在 bin 入口 `src/bin/modelbay.ts`。
 */
import { runCli } from './commands'
import type { CliDeps, CliIO } from './commands'

export interface CliMainOptions {
  /** 去掉 node 和脚本路径后的参数 */
  argv: readonly string[]
  io: CliIO
  /** 延迟创建数据源：SDK 初始化失败也要走同一条错误退出路径 */
  createDeps(): CliDeps
}

/**
 * 跑一次 CLI 调用，返回进程退出码。
 * 任何意外错误都转成 stderr 上的 `error: ...` 和退出码 1。
 */
export async function runMain(options: CliMainOptions): Promise<number> {
  try {
    const deps = options.createDeps()
    return await runCli([...options.argv], options.io, deps)
  } catch (error) {
    options.io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
