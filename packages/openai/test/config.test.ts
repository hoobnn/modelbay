import { describe, expect, it } from 'vite-plus/test'
import { ProviderError } from '@modelbay/core'
import { compatibleBaseURL, normalizedBase } from '../src/config'
import { assertSameSize, prepareEditMask } from '../src/node/index'

describe('compatibleBaseURL：渠道地址校验', () => {
  it('接受 HTTPS 域名与 localhost HTTP，去掉末尾斜杠', () => {
    expect(normalizedBase('https://llm.example.com/v1/')).toBe('https://llm.example.com/v1')
    expect(compatibleBaseURL('http://localhost:8080/v1').protocol).toBe('http:')
  })

  it('拒绝凭据 / 查询串 / 非 HTTPS / 非法域名', () => {
    for (const raw of [
      'https://user:pass@llm.example.com/v1',
      'https://llm.example.com/v1?x=1',
      'https://llm.example.com/v1#frag',
      'http://llm.example.com/v1',
      'not-a-url',
    ])
      expect(() => compatibleBaseURL(raw)).toThrow(ProviderError)
  })
})

describe('@modelbay/openai/node：蒙版辅助', () => {
  const source = { data: new Uint8Array([1]), mime: 'image/png', width: 1024, height: 1024 }
  it('原图与蒙版尺寸不同报错', () => {
    expect(() => assertSameSize(source, { ...source, height: 768 })).toThrow(ProviderError)
    expect(() => assertSameSize(source, source)).not.toThrow()
  })

  it('sharp 蒙版转换尚未接入，给出清晰 TODO 错误', () => {
    expect(() => prepareEditMask(source, source)).toThrow(/TODO/)
  })
})
