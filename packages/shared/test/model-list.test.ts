import { describe, expect, it } from 'vite-plus/test'
import { minimaxModelList, openAiModelList } from '../src/model-list'

describe('openAiModelList', () => {
  it('归一化 id / owned_by / created，跳过没有 id 的条目，并可附带类型', () => {
    expect(
      openAiModelList(
        {
          data: [
            { id: 'a', owned_by: 'x', created: 5 },
            { id: '' },
            { name: 'n' },
            'str',
            { id: 'b' },
          ],
        },
        { kind: 'llm' },
      ),
    ).toEqual([
      { id: 'a', created: 5, ownedBy: 'x', kind: 'llm' },
      { id: 'b', kind: 'llm' },
    ])
  })

  it('没有 data 数组时报错', () => {
    expect(() => openAiModelList({})).toThrow('缺少 data 数组')
  })
})

describe('minimaxModelList', () => {
  it('条目键可能是 model 或 id', () => {
    expect(
      minimaxModelList({
        data: [{ model: 'm1', owned_by: 'minimax' }, { id: 'm2' }, {}, { id: 3 }],
      }),
    ).toEqual([{ id: 'm1', ownedBy: 'minimax' }, { id: 'm2' }])
  })

  it('没有 data 数组时报错', () => {
    expect(() => minimaxModelList(null)).toThrow('缺少 data 数组')
  })
})
