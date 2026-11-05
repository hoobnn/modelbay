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
  },
  {
    key: 'bailian',
    pages: [
      { url: 'https://help.aliyun.com/zh/model-studio/models', role: 'list', channel: 'bailian' },
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
  },
  {
    key: 'minimax',
    pages: [
      { url: 'https://platform.minimax.cn/docs/faq/models', role: 'list', channel: 'minimax' },
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
