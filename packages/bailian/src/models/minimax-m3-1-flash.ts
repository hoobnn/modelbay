import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'aliyun/minimax-m3.1-flash',
  id: 'MiniMax-M3.1-Flash',
  title: 'MiniMax-M3.1-Flash',
  capabilities: ['text.chat'],
  // 输入模态 Image、Text、Video，看图支持；Function Calling 支持，结构化输出不支持。
  features: ['tools', 'vision'],
  description: 'MiniMax M3.1 Flash，文本与图片输入；深度思考始终开启，不支持联网搜索与结构化输出',
  // 上下文：https://help.aliyun.com/zh/model-studio/minimax-m3-1-flash
  // 「上下文限制」表只写「上下文窗口 1,000,000 Token」，没给最大输入与最大输出，2026-11-14 核对原文。
  contextWindow: 1000000,
  channels: [{ channel: 'bailian', id: 'MiniMax-M3.1-Flash' }],
  // 带厂商前缀的写法指向同一个模型：
  // https://help.aliyun.com/zh/model-studio/model-list-text-generation（模型目录），2026-11-14 核对原文。
  aliases: { official: ['MiniMax/MiniMax-M3.1-Flash'], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://help.aliyun.com/zh/model-studio/minimax-m3-1-flash',
      checkedAt: '2026-11-14',
    },
  },
  source: {
    url: 'https://help.aliyun.com/zh/model-studio/minimax-m3-1-flash',
    checkedAt: '2026-11-14',
  },
} satisfies ModelDeclaration
