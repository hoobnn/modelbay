/**
 * 各平台要监控的官方目录页。这是抽取比对唯一需要按平台手写的部分：
 *
 * - `list`：模型列表页。用来发现「官方有、我们没有」和「我们有、官方没列」，要写清是哪个渠道的列表。
 * - `deprecation`：下线 / 弃用公告页。用来发现生命周期该改的声明。`follow` 会继续抓页面里
 *   链到的公告详情，详情页继承链接所在小节标题里的日期。
 *
 * 声明里引用的其他来源页（参数文档等）自动作为 `reference` 页抓取：列表页漏列的模型，只要自己的
 * 来源页写着它的 ID，就不算缺失。这些页不用写在这里。
 * 新增平台时在这里加一项，见 docs/upstream.md。
 */

export interface CatalogPage {
  url: string
  role: 'list' | 'deprecation'
  /** list 页对应的渠道（`ChannelRef.channel`）。 */
  channel?: string
  /** 继续抓取页面里匹配这个正则的链接（只用于公告索引页）。 */
  follow?: RegExp
}

export interface PlatformSources {
  /** 平台键，与 `PlatformDescriptor.key` 一致。 */
  key: string
  pages: CatalogPage[]
  /** 候选模型 ID 的额外前缀；默认前缀从已声明的 ID 自动推出。 */
  prefixes?: string[]
  /** 推出来但太宽泛、会把普通词当成模型 ID 的前缀。 */
  excludePrefixes?: string[]
  /**
   * 官方列表页和来源页里本来就不会出现的渠道内 ID：设置里自填的自定义模型，或文档写法和接口实际
   * 返回不一致、已按接口核实过的 ID（写注释说明）。
   */
  unlisted?: string[]
  /**
   * 官方列表页上有、决定不接的渠道内 ID（写注释说明原因）。其余未声明的 ID 都会让跟踪 issue 开着，
   * 新模型上线第二天就有提醒；处理方式是接入，或者加进这里。
   */
  skipped?: string[]
}

export const SOURCES: PlatformSources[] = [
  {
    key: 'ark',
    pages: [
      {
        url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
        role: 'list',
        channel: 'ark',
      },
      {
        url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
        role: 'list',
        channel: 'ark-plan',
      },
      {
        url: 'https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh',
        role: 'deprecation',
      },
    ],
    unlisted: [
      'custom-chat',
      'custom-image',
      'custom-video',
      'ark-code-latest',
      // 套餐文档的表格写短横线的 doubao-seedream-5-0-pro，套餐模型目录接口实际返回点号写法
      'doubao-seedream-5.0-pro',
    ],
    skipped: [
      // 2026-11-11 基线：改成「未声明即提醒」时官方列表上已有、当时没接的 ID，没有逐个评估。
      // 要接的从这里删掉再写声明；以后新增的条目写明不接的原因。
      'doubao-seed-character-251128',
      'doubao-seed-2-0-lite-260428',
      'doubao-seed-2-0-mini-260428',
      'doubao-seed-2-0-pro-260215',
      'doubao-seed-2-0-lite-260215',
      'doubao-seed-2-0-mini-260215',
      'doubao-seed-2-0-code-preview-260215',
      'doubao-seed-character-260628',
      'doubao-seed-translation-250915',
      'glm-5-3-flash-260828',
      'glm-5-2-260617',
      'kimi-k3-1-pro-261024',
      'deepseek-v4-1-flash-261017',
      'deepseek-v4-1-flash-260910',
      'deepseek-v4-1-flash-economy-261017',
      'deepseek-v4-pro-ga-260813',
      'deepseek-v4-flash-ga-260731',
      'deepseek-v4-pro-260425',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
      'doubao-seed3d-2-0-260328',
      'doubao-embedding-vision-250615',
      'doubao-seed-2-0-mini',
      'doubao-seedream-5-0-pro',
    ],
  },
  {
    key: 'bailian',
    pages: [
      { url: 'https://help.aliyun.com/zh/model-studio/models', role: 'list', channel: 'bailian' },
      // 总览页只挑几个展示，完整的文本 / 视觉理解模型清单在这一页（总览页「查看更多」）
      {
        url: 'https://help.aliyun.com/zh/model-studio/text-generation-model',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/tts-model',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/image-model',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/video-generation',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/embedding-rerank-model',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/asr-model',
        role: 'list',
        channel: 'bailian',
      },
      {
        url: 'https://help.aliyun.com/zh/model-studio/model-depreciation',
        role: 'deprecation',
        follow: /^https:\/\/www\.aliyun\.com\/notice\/\d+$/,
      },
    ],
    skipped: [
      // 2026-11-11 基线：改成「未声明即提醒」时官方列表上已有、当时没接的 ID，没有逐个评估。
      // 要接的从这里删掉再写声明；以后新增的条目写明不接的原因。
      'happyhorse-1.1-t2v',
      'happyhorse-1.1-i2v',
      'happyhorse-1.1-r2v',
      'qwen-audio-3.1-asr-flash-message',
      'qwen-audio-3.1-asr-flash-streaming',
      'qwen-audio-3.1-asr-flash',
      'qwen-audio-3.1-asr-flash-filetrans',
      'qwen-audio-3.1-realtime-plus',
      'qwen3.5-omni-plus',
      'qwen-audio-3.1-tts-next',
      'qwen3.7-text-embedding-flash',
      'qwen3.7-text-embedding',
      'qwen3.8-omni-flash',
      'qwen3.8-omni-flash-realtime',
      'qwen3-5-omni-plus',
      'qwen-audio-3-1-tts-flash',
      'qwen-audio-3-1-tts-plus',
      'qwen3-tts-flash-realtime',
      'wan2.7-image',
      'wan2.6-t2i',
      'wan2.6-image',
      'wan2.5-t2i-preview',
      'wan2.5-i2i-preview',
      'wan2.2-t2i-plus',
      'wan2.2-t2i-flash',
      'wan2.1-t2i-plus',
      'wan2.1-t2i-turbo',
      'qwen-image-2.0-pro',
      'qwen-image-2.0-pro-2026-06-22',
      'qwen-image-2.0-pro-2026-04-22',
      'qwen-image-2.0-pro-2026-03-03',
      'qwen-image-2.0',
      'qwen-image-2.0-2026-03-03',
      'wan2.7-videoedit',
      'wan2.2-animate-move',
      'wan2.2-animate-mix',
      'happyhorse-1.0-t2v',
      'happyhorse-1.0-i2v',
      'happyhorse-1.0-r2v',
      'wan2.7-t2v',
      'wan2.7-t2v-2026-06-12',
      'wan2.7-t2v-2026-04-25',
      'wan2.7-i2v',
      'wan2.7-i2v-2026-04-25',
      'wan2.7-r2v-2026-06-12',
      'wan2.6-t2v',
      'wan2.6-i2v',
      'wan2.6-i2v-flash',
      'wan2.6-r2v',
      'wan2.6-r2v-flash',
      'wan2.5-t2v-preview',
      'wan2.5-i2v-preview',
      'wan2.2-t2v-plus',
      'wan2.2-i2v-plus',
      'wan2.2-i2v-flash',
      'wan2.2-kf2v-flash',
      'wan2.1-t2v-plus',
      'wan2.1-t2v-turbo',
      'wan2.1-i2v-plus',
      'wan2.1-i2v-turbo',
      'wan2.1-kf2v-plus',
      'wan2.1-vace-plus',
      'text-embedding-3-large',
      'qwen3-rerank',
      'text-embedding-v3',
      'qwen2.5-vl-embedding',
      'qwen3-vl-rerank',
      'qwen-audio-3.0-asr-flash-filetrans',
      'qwen3-asr-flash-realtime',
      'qwen3-asr-flash-filetrans',
      'qwen-audio-3.0-asr-flash-streaming',
      'qwen-audio-3.0-asr-flash',
      // 实时语音对话（WebSocket 双向流），不在支持的能力内
      'qwen-audio-3.1-realtime-flash',
    ],
  },
  {
    key: 'minimax',
    pages: [
      { url: 'https://platform.minimax.cn/docs/faq/models', role: 'list', channel: 'minimax' },
    ],
    skipped: [
      // 2026-11-11 基线：改成「未声明即提醒」时官方列表上已有、当时没接的 ID，没有逐个评估。
      // 要接的从这里删掉再写声明；以后新增的条目写明不接的原因。
      'MiniMax-Hailuo-2.3',
      'MiniMax-Hailuo-2.3-Fast',
      'MiniMax-Hailuo-02',
      'speech-t2a-websocket',
      'speech-2.6-hd',
      'speech-2.6-turbo',
      'speech-02-hd',
      'speech-02-turbo',
    ],
  },
  {
    key: 'doubao-speech',
    pages: [],
  },
  {
    key: 'openai',
    pages: [
      { url: 'https://developers.openai.com/api/docs/models', role: 'list', channel: 'openai' },
      { url: 'https://developers.openai.com/api/docs/deprecations', role: 'deprecation' },
    ],
    skipped: [
      // 2026-11-11 基线：改成「未声明即提醒」时官方列表上已有、当时没接的 ID，没有逐个评估。
      // 要接的从这里删掉再写声明；以后新增的条目写明不接的原因。
      'gpt-5.2',
      'gpt-5.2-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-pro',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.6-cyber',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-6-sol',
      'gpt-6-cyber',
      'gpt-audio-1.5',
      'gpt-live-1',
      'gpt-oss-120b',
      'gpt-oss-20b',
      'gpt-realtime-1.5',
      'gpt-realtime-2',
      'gpt-realtime-2.1',
      'gpt-realtime-2.1-mini',
    ],
  },
]

/** 需要浏览器渲染的域名和正文容器。只有这里登记的域名会渲染，其他拿不到 Markdown 的页面算抓取失败。 */
export const RENDER_SELECTORS: Record<string, string> = {
  'www.aliyun.com': '.aliyundotcom-notice-detail',
}

/** 官方文档域名白名单（按后缀匹配）。声明来源和抓取跳转都必须落在这里。 */
export const OFFICIAL_HOST_SUFFIXES = [
  'volcengine.com',
  'aliyun.com',
  'alibabacloud.com',
  'minimax.cn',
  'minimaxi.com',
  'minimax.io',
  'openai.com',
  'bytedance.com',
]

export function isOfficialUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return OFFICIAL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}
