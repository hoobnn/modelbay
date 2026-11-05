import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { fetchPage, linksIn } from './fetch'

type Route = { status?: number; type: string; body: string }

function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const route = routes[url] ?? { status: 404, type: 'text/html', body: 'not found' }
    return {
      status: route.status ?? 200,
      url,
      headers: new Headers({ 'content-type': route.type }),
      arrayBuffer: async () => new TextEncoder().encode(route.body).buffer,
    }
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchPage 分档抓取', () => {
  it('站点按 Accept 直接返回 Markdown', async () => {
    stubFetch({ 'https://developers.openai.com/m': { type: 'text/markdown', body: '# M' } })
    expect(await fetchPage('https://developers.openai.com/m')).toEqual({
      url: 'https://developers.openai.com/m',
      method: 'markdown',
      markdown: '# M',
    })
  })

  it('路径加 .md 拿到 Markdown', async () => {
    stubFetch({
      'https://help.aliyun.com/zh/x': { type: 'text/html', body: '<!doctype html><p>x</p>' },
      'https://help.aliyun.com/zh/x.md': { type: 'text/markdown', body: '# X' },
    })
    const page = await fetchPage('https://help.aliyun.com/zh/x')
    expect(page.method).toBe('markdown-suffix')
  })

  it('HTML 里给了 LlmsMdUrl；www.volcengine.com 的文档改走 docs 站', async () => {
    const calls = stubFetch({
      'https://docs.volcengine.com/docs/6561/1': {
        type: 'text/html',
        body: '<html>"LlmsMdUrl":"https:\\u002F\\u002Fdocs.volcengine.com\\u002Fdocs\\u002Fzh\\u002Fa.md"</html>',
      },
      'https://docs.volcengine.com/docs/zh/a.md': { type: 'text/markdown', body: '# A' },
    })
    const page = await fetchPage('https://www.volcengine.com/docs/6561/1')
    expect(page).toMatchObject({
      url: 'https://www.volcengine.com/docs/6561/1',
      method: 'embedded-markdown',
    })
    expect(calls[0]).toBe('https://docs.volcengine.com/docs/6561/1')
  })

  it('拿不到 Markdown、域名又没登记渲染容器时报错，不退到浏览器渲染', async () => {
    stubFetch({ 'https://help.aliyun.com/zh/y': { type: 'text/html', body: '<html></html>' } })
    await expect(fetchPage('https://help.aliyun.com/zh/y')).rejects.toThrow('RENDER_SELECTORS')
  })

  it('非白名单地址和 4xx 直接失败', async () => {
    stubFetch({ 'https://help.aliyun.com/gone': { status: 404, type: 'text/html', body: 'x' } })
    await expect(fetchPage('https://example.com/x')).rejects.toThrow('白名单')
    await expect(fetchPage('http://help.aliyun.com/x')).rejects.toThrow('白名单')
    await expect(fetchPage('https://help.aliyun.com/gone')).rejects.toThrow('HTTP 404')
  })

  it('linksIn 收集 Markdown 链接和裸链接', () => {
    expect(
      linksIn('见 [公告](https://www.aliyun.com/notice/1)。另见 https://www.aliyun.com/notice/2。'),
    ).toEqual(['https://www.aliyun.com/notice/1', 'https://www.aliyun.com/notice/2'])
  })
})
