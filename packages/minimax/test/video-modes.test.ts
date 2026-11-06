import { describe, expect, it } from 'vite-plus/test'
import { toModelInfo, videoModelProblem } from '@modelbay/core'
import { all } from '../src/models/index'

const counts = { image: 0, video: 0, audio: 0 }

describe('MiniMax H3 视频模式', () => {
  it.each(['MiniMax-H3', 'MiniMax-H3-Lite', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Max'])(
    '%s 不开放仅尾帧，首尾帧可用',
    (id) => {
      const model = toModelInfo(all.find((m) => m.id === id)!)
      const params = { model: `minimax/api:${id}`, aspectRatio: 'auto' }
      expect(videoModelProblem(model, { ...params, mode: 'lastFrame' }, counts, '海边')).toMatch(
        /不支持「仅尾帧」/,
      )
      expect(
        videoModelProblem(model, { ...params, mode: 'frames' }, counts, '海边') ?? '',
      ).not.toMatch(/不支持/)
    },
  )
})
