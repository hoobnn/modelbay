import { describe, expect, it } from 'vite-plus/test'
import { videoTaskOverrides } from './video-input'

describe('videoTaskOverrides 百炼 wan3.0 分支', () => {
  it('adaptive_duration 为 true 时把时长交给模型', () => {
    const model = 'aliyun/bailian:wan3.0-video'
    expect(
      videoTaskOverrides({ model, options: { [model]: { adaptive_duration: true } } }),
    ).toEqual({ duration: -1 })
  })

  it('prime 变体或没开启自适应时返回空对象', () => {
    expect(videoTaskOverrides({ model: 'aliyun/bailian:wan3.0-video-prime' })).toEqual({})
    expect(videoTaskOverrides({ model: 'aliyun/bailian:wan3.0-video' })).toEqual({})
    expect(
      videoTaskOverrides({
        model: 'aliyun/bailian:wan3.0-video',
        options: { 'aliyun/bailian:wan3.0-video': { adaptive_duration: false } },
      }),
    ).toEqual({})
  })
})
