/**
 * `@modelbay/cli` — 公开入口。
 *
 * 这里只做再导出：命令解析与分发在 `src/commands.ts`，SDK 适配在 `src/deps.ts`，
 * 进程级装配在 `src/main.ts`，bin 入口是 `src/cli.ts`。
 */

export { USAGE, parseCommand, runCli } from './commands'
export type {
  CliDeclaration,
  CliDeps,
  CliDoctorEntry,
  CliDoctorReport,
  CliGenerateRequest,
  CliIO,
  CliOutcome,
  CliOutput,
  Command,
} from './commands'
