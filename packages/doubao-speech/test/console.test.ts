import { describe, expect, it } from 'vite-plus/test'
import {
  buildQuery,
  consoleRoute,
  CONSOLE_VERSIONS,
  quoteValue,
  signedHeaders,
  utcTimestamp,
} from '../src/console'

const encoder = new TextEncoder()

const ACCESS_KEY = 'modelbay-test-access-key'
const SECRET_KEY = 'modelbay-test-secret-key'

describe('控制面签名', () => {
  it('签的是实际发出去的字节：payload 变了签名就变', async () => {
    const payload = encoder.encode('{"Name":"豆包"}')
    const query = 'Action=CreateAPIKey&Version=2025-05-20'
    const options = { timestamp: '20261009T000102Z' }
    const headers = await signedHeaders(payload, query, ACCESS_KEY, SECRET_KEY, options)
    expect(headers['X-Date']).toBe('20261009T000102Z')
    expect(headers['X-Content-Sha256']).toBe(
      'eae9df0fcb69d181ccac8c2410b9851e260801db4470890f0f13e74fd7313354',
    )
    expect(headers['Authorization']).toBe(
      `HMAC-SHA256 Credential=${ACCESS_KEY}/20261009/cn-beijing/speech_saas_prod/request, ` +
        'SignedHeaders=host;x-content-sha256;x-date, ' +
        'Signature=037e4283c340e892a55786cb0813e13e0bee74289a1edacb45cde14c05bc3481',
    )
    const changed = await signedHeaders(
      encoder.encode('{"Name":"豆包"} '),
      query,
      ACCESS_KEY,
      SECRET_KEY,
      options,
    )
    expect(changed['Authorization']).not.toBe(headers['Authorization'])
  })

  it('查询串按 key 排序，空格转成 %20', () => {
    expect(quoteValue('5 minutely')).toBe('5%20minutely')
    expect(quoteValue('volc.service_type.10029')).toBe('volc.service_type.10029')
    expect(buildQuery({ Version: '2025-05-20', Action: 'CreateAPIKey' })).toBe(
      'Action=CreateAPIKey&Version=2025-05-20',
    )
  })

  it('官方 Action → Version 对照表', () => {
    expect(CONSOLE_VERSIONS.ListAPIKeys).toBe('2025-05-20')
    expect(CONSOLE_VERSIONS.QuotaMonitoring).toBe('2025-05-21')
    expect(CONSOLE_VERSIONS.ListMegaTTSByOrderID).toBe('2023-11-07')
    expect(CONSOLE_VERSIONS.UnknownAction).toBeUndefined()
  })

  it('配额监控的旧版本与 ListApplications 走 cn-north-1 的 GET', () => {
    expect(consoleRoute('QuotaMonitoring', '2021-08-30')).toEqual({
      method: 'GET',
      region: 'cn-north-1',
    })
    expect(consoleRoute('ListApplications', '2025-05-20')).toEqual({
      method: 'GET',
      region: 'cn-north-1',
    })
    expect(consoleRoute('ListAPIKeys', '2025-05-20')).toEqual({
      method: 'POST',
      region: 'cn-beijing',
    })
  })

  it('UTC 时间戳用官方格式', () => {
    expect(utcTimestamp(new Date('2026-10-09T00:01:02.345Z'))).toBe('20261009T000102Z')
  })
})
