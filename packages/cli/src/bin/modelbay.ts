#!/usr/bin/env node
/**
 * `modelbay` bin entry. This is the only module allowed to touch `process.*`.
 * It wires the real SDK into the injected `CliDeps` that `runMain()` needs.
 */
import { createModelbay } from 'modelbay'
import { createCliDeps } from '../deps'
import { runMain } from '../main'

const code = await runMain({
  argv: process.argv.slice(2),
  io: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  createDeps: () => createCliDeps(createModelbay()),
})

process.exitCode = code
