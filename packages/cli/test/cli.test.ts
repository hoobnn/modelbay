import { describe, expect, it } from 'vite-plus/test'
import { USAGE, parseCommand, runCli } from '../src/index'
import type { CliDeclaration, CliDeps, CliGenerateRequest, CliIO } from '../src/index'

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

const declarations: CliDeclaration[] = [
  {
    canonicalId: 'ark/seedream',
    capabilities: ['image.generate', 'image.edit'],
    channels: [{ channel: 'ark' }],
    lifecycle: { status: 'active' },
  },
  {
    canonicalId: 'minimax/speech-2.8-hd',
    capabilities: ['audio.speech'],
    channels: [{ channel: 'minimax' }],
    lifecycle: { status: 'sunsetting' },
  },
]

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    models: () => declarations,
    capabilities: () => ['audio.speech', 'image.generate'],
    doctor: () => ({
      entries: [
        { platform: 'ark', names: ['ARK_API_KEY'], configured: true },
        { platform: 'bailian', names: ['DASHSCOPE_API_KEY'], configured: false },
      ],
      ok: true,
    }),
    generate: async () => ({ outputs: [{ type: 'file', url: 'https://cdn.example/image.png' }] }),
    ...overrides,
  }
}

describe('parseCommand', () => {
  it('无参数 / --help / -h / help 都返回 help', () => {
    expect(parseCommand([])).toEqual({ kind: 'help' })
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['-h'])).toEqual({ kind: 'help' })
    expect(parseCommand(['help'])).toEqual({ kind: 'help' })
  })

  it('models 可带一个可选平台', () => {
    expect(parseCommand(['models'])).toEqual({ kind: 'models' })
    expect(parseCommand(['models', 'ark'])).toEqual({ kind: 'models', platform: 'ark' })
    expect(parseCommand(['models', 'ark', 'extra']).kind).toBe('error')
  })

  it('capabilities / doctor 不接受参数', () => {
    expect(parseCommand(['capabilities'])).toEqual({ kind: 'capabilities' })
    expect(parseCommand(['doctor'])).toEqual({ kind: 'doctor' })
    expect(parseCommand(['doctor', 'x']).kind).toBe('error')
    expect(parseCommand(['capabilities', 'x']).kind).toBe('error')
  })

  it('generate 解析空格与 = 两种 flag 写法', () => {
    expect(
      parseCommand([
        'generate',
        '--capability',
        'image.generate',
        '--prompt',
        'a cat',
        '--model',
        'ark:seedream',
      ]),
    ).toEqual({
      kind: 'generate',
      capability: 'image.generate',
      prompt: 'a cat',
      model: 'ark:seedream',
    })
    expect(parseCommand(['generate', '--capability=video.generate', '--prompt=a wave'])).toEqual({
      kind: 'generate',
      capability: 'video.generate',
      prompt: 'a wave',
    })
  })

  it('generate 缺参数 / 无法识别的参数报错', () => {
    expect(parseCommand(['generate', '--prompt', 'x']).kind).toBe('error')
    expect(parseCommand(['generate', '--capability']).kind).toBe('error')
    expect(parseCommand(['generate', 'oops']).kind).toBe('error')
  })

  it('未知命令报错', () => {
    expect(parseCommand(['frobnicate'])).toEqual({
      kind: 'error',
      message: 'unknown command: frobnicate',
    })
  })
})

describe('runCli', () => {
  it('help 打印 usage 并退出 0', async () => {
    const { io, out, err } = fakeIO()
    const code = await runCli(['--help'], io, makeDeps())
    expect(code).toBe(0)
    expect(out.join('')).toBe(USAGE)
    expect(err).toEqual([])
  })

  it('错误命令打印到 stderr 并退出 1', async () => {
    const { io, out, err } = fakeIO()
    const code = await runCli(['nope'], io, makeDeps())
    expect(code).toBe(1)
    expect(err.join('')).toContain('unknown command: nope')
    expect(out).toEqual([])
  })

  it('models 列出规范 ID、生命周期与能力', async () => {
    const { io, out } = fakeIO()
    const code = await runCli(['models'], io, makeDeps())
    expect(code).toBe(0)
    const text = out.join('')
    expect(text).toContain('ark/seedream\tactive\timage.generate, image.edit')
    expect(text).toContain('minimax/speech-2.8-hd\tsunsetting\taudio.speech')
  })

  it('models 可按平台过滤', async () => {
    const { io, out } = fakeIO()
    await runCli(['models', 'ark'], io, makeDeps())
    const text = out.join('')
    expect(text).toContain('ark/seedream')
    expect(text).not.toContain('minimax/')
  })

  it('models 无匹配时给出提示', async () => {
    const { io, out } = fakeIO()
    await runCli(['models', 'unknown'], io, makeDeps())
    expect(out.join('')).toContain('no models for platform unknown')
  })

  it('capabilities 列出能力', async () => {
    const { io, out } = fakeIO()
    const code = await runCli(['capabilities'], io, makeDeps())
    expect(code).toBe(0)
    expect(out.join('')).toBe('audio.speech\nimage.generate\n')
  })

  it('doctor 只打印配置状态，不打印 key 值', async () => {
    const { io, out } = fakeIO()
    const deps = makeDeps({
      doctor: () => ({
        entries: [{ platform: 'ark', names: ['ARK_API_KEY'], configured: true }],
        ok: true,
      }),
    })
    const code = await runCli(['doctor'], io, deps)
    expect(code).toBe(0)
    expect(out.join('')).toContain('ark: configured (ARK_API_KEY)')
  })

  it('doctor 全部缺失时退出 1', async () => {
    const { io } = fakeIO()
    const deps = makeDeps({
      doctor: () => ({
        entries: [{ platform: 'ark', names: ['ARK_API_KEY'], configured: false }],
        ok: false,
      }),
    })
    const code = await runCli(['doctor'], io, deps)
    expect(code).toBe(1)
  })

  it('generate 调用汇总入口并打印 URL', async () => {
    const { io, out } = fakeIO()
    let captured: CliGenerateRequest | undefined
    const deps = makeDeps({
      generate: async (request) => {
        captured = request
        return { outputs: [{ type: 'file', url: 'https://cdn.example/image.png' }] }
      },
    })
    const code = await runCli(
      [
        'generate',
        '--capability',
        'image.generate',
        '--prompt',
        'a cat',
        '--model',
        'ark:seedream',
      ],
      io,
      deps,
    )
    expect(code).toBe(0)
    expect(captured).toEqual({
      capability: 'image.generate',
      model: 'ark:seedream',
      input: { prompt: 'a cat' },
    })
    expect(out.join('')).toContain('https://cdn.example/image.png')
  })

  it('配音 generate 用 text 字段', async () => {
    const { io } = fakeIO()
    let captured: CliGenerateRequest | undefined
    const deps = makeDeps({
      generate: async (request) => {
        captured = request
        return { outputs: [{ type: 'text', text: 'ok' }] }
      },
    })
    await runCli(['generate', '--capability', 'audio.speech', '--prompt', '你好'], io, deps)
    expect(captured?.input).toEqual({ text: '你好' })
  })

  it('不支持的 capability 报错', async () => {
    const { io, err } = fakeIO()
    const code = await runCli(
      ['generate', '--capability', 'not.a.capability', '--prompt', 'x'],
      io,
      makeDeps(),
    )
    expect(code).toBe(1)
    expect(err.join('')).toContain('unsupported capability')
  })

  it('generate 抛错时转为 stderr 与退出码 1', async () => {
    const { io, err } = fakeIO()
    const deps = makeDeps({
      generate: async () => {
        throw new Error('上游不可用')
      },
    })
    const code = await runCli(
      ['generate', '--capability', 'image.generate', '--prompt', 'x'],
      io,
      deps,
    )
    expect(code).toBe(1)
    expect(err.join('')).toContain('上游不可用')
  })
})
