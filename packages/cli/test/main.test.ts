import { describe, expect, it } from 'vite-plus/test'
import { runMain } from '../src/main'
import type { CliDeps, CliIO } from '../src/commands'

function fakeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = {
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
  }
  return { io, out, err }
}

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    models: () => [],
    capabilities: () => [],
    doctor: () => ({ entries: [], ok: false }),
    generate: async () => ({ outputs: [] }),
    ...overrides,
  }
}

describe('runMain', () => {
  it('help 返回 0，usage 走 stdout', async () => {
    const { io, out, err } = fakeIO()
    const code = await runMain({ argv: ['--help'], io, createDeps: () => fakeDeps() })
    expect(code).toBe(0)
    expect(out.join('')).toContain('modelbay — CLI for Modelbay')
    expect(err).toEqual([])
  })

  it('未知命令返回 1，错误走 stderr', async () => {
    const { io, out, err } = fakeIO()
    const code = await runMain({ argv: ['nope'], io, createDeps: () => fakeDeps() })
    expect(code).toBe(1)
    expect(err.join('')).toContain('unknown command: nope')
    expect(out).toEqual([])
  })

  it('SDK 初始化失败时返回 1 并把错误写到 stderr', async () => {
    const { io, err } = fakeIO()
    const code = await runMain({
      argv: ['models'],
      io,
      createDeps: () => {
        throw new Error('没有可用的平台适配器')
      },
    })
    expect(code).toBe(1)
    expect(err.join('')).toContain('error: 没有可用的平台适配器')
  })

  it('抛的不是 Error 时按字符串处理', async () => {
    const { io, err } = fakeIO()
    const code = await runMain({
      argv: ['models'],
      io,
      createDeps: () => {
        throw 'boom'
      },
    })
    expect(code).toBe(1)
    expect(err.join('')).toContain('error: boom')
  })

  it('argv 原样传给命令层', async () => {
    const { io, out } = fakeIO()
    const code = await runMain({
      argv: ['capabilities'],
      io,
      createDeps: () => fakeDeps({ capabilities: () => ['image.generate', 'audio.speech'] }),
    })
    expect(code).toBe(0)
    expect(out.join('')).toBe('image.generate\naudio.speech\n')
  })

  it('generate 失败时返回 1', async () => {
    const { io, err } = fakeIO()
    const code = await runMain({
      argv: ['generate', '--capability', 'image.generate', '--prompt', 'x'],
      io,
      createDeps: () =>
        fakeDeps({
          generate: async () => {
            throw new Error('上游超时')
          },
        }),
    })
    expect(code).toBe(1)
    expect(err.join('')).toContain('上游超时')
  })
})
