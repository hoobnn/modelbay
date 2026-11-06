/**
 * MODELBAY_MCP_OUT_DIR：调用没给 out_dir 时落到 `<目录>/<平台>`，显式 out_dir 优先。
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterContext, readSecrets } from 'modelbay'
import { describe, expect, it } from 'vite-plus/test'
import { createMcpAssetSource } from '../src/assets'
import { generateTools } from '../src/generate'
import { resolveOutDir } from '../src/launch'
import { createHandlers } from '../src/routing'
import { MCP_TOOL_GROUPS } from '../src/types'
import { platformOf } from './fixtures'

const PNG = 'iVBORw0KGgo='

function handlersWith(defaultOutDir: string | undefined) {
  const platform = platformOf('openai')
  const adapter = platform.createAdapters()[0]!
  const fetchImpl = (async () =>
    Response.json({ data: [{ b64_json: PNG }], usage: { total_tokens: 1 } })) as typeof fetch
  return createHandlers({
    set: generateTools(platform, { adapter }),
    adapter,
    context: createAdapterContext({
      secrets: readSecrets(platform.secrets, { OPENAI_API_KEY: 'k' }),
      fetchImpl,
      assets: createMcpAssetSource({ fetchImpl }),
    }),
    groups: MCP_TOOL_GROUPS.all,
    secrets: platform.secrets,
    primaryChannel: platform.primaryChannel,
    serverInfo: { name: 'test', version: '0.0.0' },
    ...(defaultOutDir ? { defaultOutDir } : {}),
  })
}

const call = { model: 'openai:gpt-image-2.6-flare', prompt: '猫' }

describe('MODELBAY_MCP_OUT_DIR', () => {
  it('resolveOutDir：按平台分子目录，展开 ~，空值不落盘', () => {
    expect(resolveOutDir({}, 'ark')).toBeUndefined()
    expect(resolveOutDir({ MODELBAY_MCP_OUT_DIR: '  ' }, 'ark')).toBeUndefined()
    expect(resolveOutDir({ MODELBAY_MCP_OUT_DIR: '/tmp/mb' }, 'ark')).toBe('/tmp/mb/ark')
    expect(
      resolveOutDir({ MODELBAY_MCP_OUT_DIR: '~/Downloads/mb', HOME: '/home/u' }, 'minimax'),
    ).toBe('/home/u/Downloads/mb/minimax')
  })

  it('没给 out_dir 时写到默认目录', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'modelbay-outdir-')), 'openai')
    const result = await handlersWith(dir).callTool('generate_image', call)
    expect(result.isError).toBeFalsy()
    expect(readdirSync(dir).length).toBe(1)
  })

  it('显式 out_dir 优先于默认目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'modelbay-outdir-'))
    const fallback = join(root, 'default')
    const explicit = join(root, 'explicit')
    await handlersWith(fallback).callTool('generate_image', { ...call, out_dir: explicit })
    expect(readdirSync(explicit).length).toBe(1)
    expect(existsSync(fallback)).toBe(false)
  })

  it('不设默认目录时不落盘，图片按 MCP image 块返回', async () => {
    const result = await handlersWith(undefined).callTool('generate_image', call)
    expect(result.content.some((block) => block.type === 'image')).toBe(true)
  })
})
