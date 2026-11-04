/**
 * `@modelbay/cli` 的纯命令逻辑：参数解析与子命令分发。
 *
 * 这个模块不引入任何运行时依赖（没有 `modelbay`，没有 `node:*`）：
 * I/O 和数据源都由调用方注入，所以不用联网、不用加载 SDK 就能单测。
 * `src/deps.ts` 负责把 SDK 适配成这里需要的数据源，`src/cli.ts` 是 bin 入口。
 */

/** Output sinks; the CLI entry uses `process.stdout.write` / `process.stderr.write`. */
export interface CliIO {
  stdout(text: string): void
  stderr(text: string): void
}

export interface CliDeclaration {
  canonicalId: string
  capabilities: readonly string[]
  channels: readonly { channel: string }[]
  lifecycle: { status: string }
}

export interface CliOutput {
  type: string
  text?: string
  value?: unknown
  url?: string
  data?: Uint8Array
  kind?: string
  mime?: string
  name?: string
}

export interface CliDoctorEntry {
  platform: string
  names: readonly string[]
  configured: boolean
}

export interface CliDoctorReport {
  entries: readonly CliDoctorEntry[]
  ok: boolean
}

export interface CliGenerateRequest {
  capability: string
  model?: string
  input: Record<string, unknown>
  signal?: AbortSignal
}

export interface CliOutcome {
  outputs: readonly CliOutput[]
}

/** Everything `runCli` needs from the SDK, injected by the bin entry. */
export interface CliDeps {
  models(): readonly CliDeclaration[]
  capabilities(): readonly string[]
  doctor(): CliDoctorReport
  generate(request: CliGenerateRequest): Promise<CliOutcome>
}

export type Command =
  | { kind: 'models'; platform?: string }
  | { kind: 'capabilities' }
  | { kind: 'doctor' }
  | { kind: 'generate'; capability: string; model?: string; prompt: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/** Capabilities that take a single text prompt. `audio.speech` uses `text`. */
const GENERATE_CAPABILITIES: readonly string[] = [
  'text.chat',
  'image.generate',
  'image.edit',
  'image.process',
  'video.generate',
  'audio.speech',
  'audio.music',
  'audio.sfx',
  'audio.transcribe',
]

export const USAGE = `modelbay — CLI for Modelbay

Usage:
  modelbay models [platform]       List models and their lifecycle status
  modelbay capabilities            List capabilities
  modelbay doctor                  Check key configuration (never prints keys)
  modelbay generate --capability <cap> --prompt <text> [--model <ref>]
  modelbay help                    Show this help

Supported --capability values:
  ${GENERATE_CAPABILITIES.join(', ')}
`

/** Pure argument parser; no side effects, safe to call in tests. */
export function parseCommand(argv: string[]): Command {
  const [head, ...rest] = argv
  if (!head || head === '--help' || head === '-h' || head === 'help') return { kind: 'help' }

  switch (head) {
    case 'models': {
      if (rest.length > 1) return { kind: 'error', message: 'models takes at most one platform' }
      return rest[0] ? { kind: 'models', platform: rest[0] } : { kind: 'models' }
    }
    case 'capabilities':
      return rest.length === 0
        ? { kind: 'capabilities' }
        : { kind: 'error', message: 'capabilities takes no arguments' }
    case 'doctor':
      return rest.length === 0
        ? { kind: 'doctor' }
        : { kind: 'error', message: 'doctor takes no arguments' }
    case 'generate':
      return parseGenerate(rest)
    default:
      return { kind: 'error', message: `unknown command: ${head}` }
  }
}

function parseGenerate(args: string[]): Command {
  const flags: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token?.startsWith('--')) {
      return { kind: 'error', message: `unrecognized argument: ${token ?? ''}` }
    }
    const body = token.slice(2)
    const equals = body.indexOf('=')
    if (equals >= 0) {
      const key = body.slice(0, equals)
      const value = body.slice(equals + 1)
      if (!key || !value) return { kind: 'error', message: `malformed flag: --${body}` }
      flags[key] = value
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      return { kind: 'error', message: `--${body} needs a value` }
    }
    flags[body] = value
    index += 1
  }

  const capability = flags['capability']
  const prompt = flags['prompt']
  if (!capability) return { kind: 'error', message: 'generate needs --capability' }
  if (!prompt) return { kind: 'error', message: 'generate needs --prompt' }
  return {
    kind: 'generate',
    capability,
    prompt,
    ...(flags['model'] ? { model: flags['model'] } : {}),
  }
}

function matchesPlatform(model: CliDeclaration, platform: string): boolean {
  return (
    model.channels.some((channel) => channel.channel === platform) ||
    model.canonicalId.split('/')[0] === platform
  )
}

function listModels(platform: string | undefined, io: CliIO, deps: CliDeps): number {
  const all = deps.models()
  const models = platform ? all.filter((model) => matchesPlatform(model, platform)) : all
  if (models.length === 0) {
    io.stdout(platform ? `no models for platform ${platform}\n` : 'no registered models\n')
    return 0
  }
  const lines = models.map(
    (model) => `${model.canonicalId}\t${model.lifecycle.status}\t${model.capabilities.join(', ')}`,
  )
  io.stdout(`${lines.join('\n')}\n`)
  return 0
}

function showDoctor(io: CliIO, deps: CliDeps): number {
  const report = deps.doctor()
  const lines = report.entries.map(
    (entry) =>
      `${entry.platform}: ${entry.configured ? 'configured' : 'missing'} ` +
      `(${entry.names.join(', ')})`,
  )
  io.stdout(`${lines.join('\n')}\n`)
  return report.ok ? 0 : 1
}

function formatOutput(output: CliOutput): string {
  if (output.url) return output.url
  if (output.data) return `[bytes] ${output.data.byteLength} bytes`
  if (output.type === 'text' && output.text !== undefined) return output.text
  if (output.type === 'json') return JSON.stringify(output.value)
  return `[${output.type}]`
}

async function runGenerate(
  command: Extract<Command, { kind: 'generate' }>,
  io: CliIO,
  deps: CliDeps,
): Promise<number> {
  if (!GENERATE_CAPABILITIES.includes(command.capability)) {
    io.stderr(`error: unsupported capability: ${command.capability}\n`)
    return 1
  }
  // 配音用 text 字段，其余能力用 prompt 字段
  const input: Record<string, unknown> =
    command.capability === 'audio.speech' ? { text: command.prompt } : { prompt: command.prompt }
  try {
    const outcome = await deps.generate({
      capability: command.capability,
      ...(command.model ? { model: command.model } : {}),
      input,
    })
    for (const output of outcome.outputs) io.stdout(`${formatOutput(output)}\n`)
    return 0
  } catch (error) {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/** Execute a parsed command; returns a process exit code. */
export async function runCli(argv: string[], io: CliIO, deps: CliDeps): Promise<number> {
  const command = parseCommand(argv)
  switch (command.kind) {
    case 'help':
      io.stdout(USAGE)
      return 0
    case 'error':
      io.stderr(`error: ${command.message}\n\n${USAGE}`)
      return 1
    case 'models':
      return listModels(command.platform, io, deps)
    case 'capabilities':
      io.stdout(`${deps.capabilities().join('\n')}\n`)
      return 0
    case 'doctor':
      return showDoctor(io, deps)
    case 'generate':
      return runGenerate(command, io, deps)
  }
}
