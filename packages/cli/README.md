# @modelbay/cli

Command-line interface for [Modelbay](../../README.md). The command name is
`modelbay`.

MIT licensed.

## Install

```sh
pnpm add -D @modelbay/cli
# or run without installing globally:
pnpm dlx modelbay models
```

Set the platform keys in the environment first (see the `modelbay` package
README). The CLI reads them through `createModelbay()`.

## Commands

| Command                                                                | Description                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `modelbay models [platform]`                                           | List models with their lifecycle status              |
| `modelbay capabilities`                                                | List normalized capabilities                         |
| `modelbay doctor`                                                      | Check key configuration. **Never prints key values** |
| `modelbay generate --capability <cap> --prompt <text> [--model <ref>]` | Run a generation through the aggregation entry       |
| `modelbay help`                                                        | Show usage                                           |

`generate` supports the capabilities that take a single text prompt. For
`audio.speech` the prompt is sent as the `text` field; for image/video/music
capabilities it is sent as `prompt`. `--model` accepts `channel:model-id` as
well as canonical IDs, official aliases and short names.

Examples:

```sh
modelbay models ark
modelbay doctor
modelbay generate --capability image.generate --prompt "a cat" --model ark:doubao-seedream
modelbay generate --capability audio.speech --prompt "你好，世界"
```

## Exit codes

- `0` — success, or `doctor` found at least one fully configured platform.
- `1` — parse error, unsupported capability, a failing generation, or `doctor`
  found no configured platform.

## Design notes

- `src/index.ts` is a re-export barrel. The command parsing and dispatch logic
  lives in `src/commands.ts`, which contains no `console.*` and no runtime
  imports of the SDK; `runCli()` receives its I/O and data sources through
  injection, which keeps it unit-testable without network access.
- `src/deps.ts` adapts the SDK entry into the data sources the command layer
  needs; `src/main.ts` wires argv, output channels and exit codes together.
- `src/bin/modelbay.ts` is the bin entry and is the only module that touches
  `process.stdout` / `process.stderr` / `process.argv`.
- Results are printed as URLs or byte counts; the CLI never downloads or stores
  generated files, and never prints keys.
