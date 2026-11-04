#!/usr/bin/env node
/**
 * `modelbay` bin entry. This is the only module allowed to touch `process.*`.
 * It adapts `createModelbay()` to the injected `CliDeps` that `runCli()` needs.
 */
import { createModelbay } from 'modelbay'
import type { Capability, CapabilityInput } from 'modelbay'
import { runCli } from './index'
import type { CliDeps } from './index'

async function main(): Promise<void> {
  const mb = createModelbay()

  const deps: CliDeps = {
    models: () => mb.registry.all(),
    capabilities: () => mb.capabilities(),
    doctor: () => mb.doctor(),
    generate: (request) =>
      mb.generate({
        capability: request.capability as Capability,
        ...(request.model ? { model: request.model } : {}),
        input: request.input as CapabilityInput<Capability>,
        ...(request.signal ? { signal: request.signal } : {}),
      }),
  }

  const code = await runCli(
    process.argv.slice(2),
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    deps,
  )
  process.exitCode = code
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
