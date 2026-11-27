import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  captureCoverage,
  readCapture,
  writeCapture,
  type CapturedPage,
  type PageEntry,
} from './snapshots'

describe('上游文档快照', () => {
  it('普通参考页缺失与生命周期证据缺失分别处理', () => {
    const catalog: CapturedPage = {
      entry: { url: 'https://example.com/list', role: 'list', channel: 'c' },
      markdown: '# list',
    }
    const reference: CapturedPage = {
      entry: { url: 'https://example.com/ref', role: 'reference' },
      error: '超时',
    }
    const notice: CapturedPage = {
      entry: { url: 'https://example.com/notice', role: 'deprecation' },
      error: '超时',
    }
    expect(captureCoverage([catalog, reference])).toMatchObject({
      complete: false,
      lifecycleComplete: true,
    })
    expect(captureCoverage([catalog, reference, notice])).toMatchObject({
      complete: false,
      lifecycleComplete: false,
    })
  })

  it('分别保存文件名相似的来源，并可重放原始抓取失败', () => {
    const directory = mkdtempSync(join(tmpdir(), 'modelbay-capture-'))
    try {
      const pages: CapturedPage[] = [
        { entry: { url: 'https://example.com/v4.1', role: 'reference' }, markdown: '# dot' },
        { entry: { url: 'https://example.com/v4-1', role: 'reference' }, markdown: '# dash' },
        {
          entry: { url: 'https://example.com/missing', role: 'list', channel: 'c' },
          error: '超时',
        },
      ]
      writeCapture(directory, pages)
      expect(readCapture(directory)).toEqual(pages)
      const next = [pages[0]!]
      writeCapture(directory, next)
      expect(readCapture(directory)).toEqual(next)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('用旧索引读正文，无法取得正文时记录失败', () => {
    const directory = mkdtempSync(join(tmpdir(), 'modelbay-capture-'))
    try {
      const list: PageEntry = { url: 'https://example.com/list', role: 'list', channel: 'c' }
      const reference: PageEntry = { url: 'https://example.com/ref', role: 'reference' }
      mkdirSync(join(directory, 'pages'))
      writeFileSync(join(directory, 'pages', 'example-com-list.md'), '# list')
      writeFileSync(join(directory, 'pages.json'), JSON.stringify([list, reference]))
      expect(readCapture(directory)).toMatchObject([
        { entry: list, markdown: '# list' },
        { entry: reference, error: expect.any(String) },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
