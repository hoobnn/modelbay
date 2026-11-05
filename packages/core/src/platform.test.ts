import { describe, expect, it } from 'vite-plus/test'
import { definePlatform, missingSecrets, readSecrets, secretEnvNames } from './platform'

const secrets = {
  required: [['API_KEY'], ['APP_ID', 'TOKEN']],
  optional: ['BASE_URL'],
  aliases: { API_KEY: ['OLD_API_KEY'], TOKEN: ['OLD_TOKEN'] },
}

describe('平台密钥', () => {
  it('secretEnvNames 包含必填、可选与别名，且不重复', () => {
    expect(secretEnvNames(secrets).sort()).toEqual(
      ['API_KEY', 'APP_ID', 'BASE_URL', 'OLD_API_KEY', 'OLD_TOKEN', 'TOKEN'].sort(),
    )
  })

  it('readSecrets 只取声明过的名字，忽略空值', () => {
    expect(readSecrets(secrets, { OLD_API_KEY: ' k ', BASE_URL: '', PATH: '/bin' })).toEqual({
      OLD_API_KEY: 'k',
    })
  })

  it('missingSecrets：任一组配齐即可，别名也算', () => {
    expect(missingSecrets(secrets, (name) => name === 'OLD_API_KEY')).toEqual([])
    expect(missingSecrets(secrets, (name) => name === 'APP_ID' || name === 'OLD_TOKEN')).toEqual([])
  })

  it('missingSecrets：缺失时报告最接近配齐的那一组', () => {
    expect(missingSecrets(secrets, () => false)).toEqual(['API_KEY'])
    expect(missingSecrets(secrets, (name) => name === 'APP_ID')).toEqual(['TOKEN'])
    expect(missingSecrets({ required: [] }, () => false)).toEqual([])
  })

  it('definePlatform 原样返回描述对象', () => {
    const platform = definePlatform({
      key: 'x',
      title: 'X',
      primaryChannel: 'x',
      secrets,
      createAdapters: () => [],
    })
    expect(platform.createAdapters()).toEqual([])
  })
})
