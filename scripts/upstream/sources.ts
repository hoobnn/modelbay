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
   * 模型 ID 不带版本号（数字）的前缀。候选规则默认要求 ID 带数字，免得把文档路径
   * 当成模型；有些平台的模型 ID 就是不带数字的（OpenAI 的 `gpt-transcribe`），
   * 在这里按前缀放行。
   */
  digitless?: string[]
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
    key: 'deepseek',
    pages: [
      {
        url: 'https://api-docs.deepseek.com/quick_start/pricing/',
        role: 'list',
        channel: 'deepseek',
      },
      // 没有独立下线公告页；updates 混合发布、价格与旧型号迁移信息，不能按整页下线公告抽取。
      // 当前型号与旧型号兼容/退休状态以 pricing 页为准。
    ],
    skipped: [
      // 2026-11-13：官方说明旧模型已经退休，仅兼容路由至 deepseek-flash。
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ],
  },
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
    // 3D 生成系列：方舟列表页有，modelbay 没有对应能力。前缀只取开头纯字母段，
    // 所以 hyper3d / hitem3d 要写成 hyper / hitem 才认得出来。
    prefixes: ['hyper', 'hitem'],
    unlisted: [
      'custom-chat',
      'custom-image',
      'custom-video',
      'ark-code-latest',
      // 套餐文档的表格写短横线的 doubao-seedream-5-0-pro，套餐模型目录接口实际返回点号写法
      'doubao-seedream-5.0-pro',
    ],
    skipped: [
      // 2026-11-11 逐个核对官方列表页后分组；要接的从这里删掉再写声明，新增条目写明不接的原因。
      // 写法变体：套餐表格的短横线写法，套餐接口用点号，已按点号声明
      'doubao-seed-2-0-mini',
      'doubao-seedream-5-0-pro',
      // 旧版本 / 旧快照：已声明更新的版本（Seed 2.1、Seedream 5.0、Seedance 2.x、embedding-vision-251215）
      'doubao-seed-2-0-lite-260428',
      'doubao-seed-2-0-mini-260428',
      'doubao-seed-2-0-pro-260215',
      'doubao-seed-2-0-lite-260215',
      'doubao-seed-2-0-mini-260215',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
      'doubao-embedding-vision-250615',
      // 专用对话模型（角色扮演、翻译、代码预览）：不单独声明，需要时用 custom-chat 填 ID
      'doubao-seed-character-251128',
      'doubao-seed-character-260628',
      'doubao-seed-translation-250915',
      'doubao-seed-2-0-code-preview-260215',
      // 3D 生成：没有对应能力
      'doubao-seed3d-2-0-260328',
      'hyper3d-gen2-260112',
      'hitem3d-2-0-251223',
      // 第三方模型的旧快照：deepseek-v4-1-flash-260910 已有更新的 261017；deepseek-v4-pro-260425 在第十批下线公告里
      // （2026-11-24 下线，按量渠道已声明 deepseek-v4-pro-ga-260813）；glm-5-2-260617 已有 glm-5.3 系列
      'deepseek-v4-1-flash-260910',
      'deepseek-v4-pro-260425',
      'glm-5-2-260617',
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
    // 百炼转售第三方模型：这些系列在百炼一个都没声明过，前缀得写明，官方上新才看得见。
    // 前缀只取开头那段连续字母，所以 `Tripo/…` 写 `tripo`、`ZHIPU/…` 写 `zhipu`。
    prefixes: [
      'deepseek',
      'glm',
      'kimi',
      'minimax',
      'mimo',
      'step',
      'antdigital',
      'kling',
      'pixverse',
      'siliconflow',
      'tripo',
      'unisound',
      'vanchin',
      'vidu',
      'xiaomi',
      'zhipu',
    ],
    skipped: [
      // 2026-11-11 逐个核对官方列表页后分组；要接的从这里删掉再写声明，新增条目写明不接的原因。
      // 不是模型 ID：文档链接路径里的短横线写法（qwen-audio-3.1-tts-* 已按点号声明）
      'qwen3-5-omni-plus',
      'qwen-audio-3-1-tts-flash',
      'qwen-audio-3-1-tts-plus',
      // 不是百炼模型：迁移对照表里列的 OpenAI 模型
      'text-embedding-3-large',
      // 实时 / 全模态对话（WebSocket 双向流或音频输出），不在支持的能力内
      'qwen-audio-3.1-realtime-flash',
      'qwen-audio-3.1-realtime-plus',
      'qwen3.5-omni-plus',
      'qwen3.8-omni-flash',
      'qwen3.8-omni-flash-realtime',
      'qwen3-tts-flash-realtime',
      'qwen3-asr-flash-realtime',
      'qwen-audio-3.1-asr-flash-streaming',
      'qwen-audio-3.0-asr-flash-streaming',
      'qwen-audio-3.1-asr-flash-message',
      // 实时双工语音对话（端到端语音转语音，支持委派后台任务），与 realtime 系列同类
      'qwen-audio-3.1-live',
      // 音频打标：输出带时间标记的语音 / 音效 / 背景声标注与场景描述，是音频理解而非转写；
      // 现有能力里没有对应项，请求体（input.file_url）与结果（text 内嵌标注 JSON）也和 audio.transcribe 不同
      'qwen-audio-3.1-captioner',
      // 旧版本 / 旧快照：已声明更新的版本（qwen-image-3.0、wan2.7-image-pro、wan3.0-video、text-embedding-v4、
      // qwen3-vl-embedding、qwen3.7-text-rerank、qwen3-asr-flash）
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
      'happyhorse-1.0-t2v',
      'happyhorse-1.0-i2v',
      'happyhorse-1.0-r2v',
      'text-embedding-v3',
      'qwen2.5-vl-embedding',
      'qwen3-rerank',
      'qwen-audio-3.0-asr-flash',
      'qwen-audio-3.0-asr-flash-filetrans',
      'qwen3-asr-flash-filetrans',
      // 专用视频模型（特效 / 运镜复刻、角色动画、换人），没有对应的归一化能力
      'wan2.7-videoedit',
      'wan2.2-animate-move',
      'wan2.2-animate-mix',
      // 2026-11-14 补上 prefixes 后新报出的百炼转售模型，文本类的已全部接入并写进声明。
      // 写法变体：短横线写法与已声明的 glm-5.3 是同一个（文档链接路径里的写法）
      'glm-5-3',
      // 不是模型 ID：系列名（小标题），下面的具体型号才是模型 ID
      'Qwen3-TTS',
      'Qwen3-ASR',
      // 3D 模型生成：modelbay 没有 3D 能力（厂商前缀写法与不带前缀的写法都在列表页上）
      'Tripo/Tripo-H3.1',
      'Tripo/Tripo-P1.0',
      'Tripo-H3.1',
      'Tripo-P1.0',
      // 不是模型 ID：文档链接路径
      'tripo-3d-generation-guide',
    ],
  },
  {
    key: 'minimax',
    pages: [
      { url: 'https://platform.minimax.cn/docs/faq/models', role: 'list', channel: 'minimax' },
    ],
    skipped: [
      // 2026-11-11 逐个核对官方列表页后分组；要接的从这里删掉再写声明，新增条目写明不接的原因。
      // 不是模型 ID：文档链接路径
      'speech-t2a-websocket',
      // 旧版本：已声明 MiniMax-H3 视频与 speech-2.8
      'MiniMax-Hailuo-2.3',
      'MiniMax-Hailuo-2.3-Fast',
      'MiniMax-Hailuo-02',
      'speech-2.6-hd',
      'speech-2.6-turbo',
      'speech-02-hd',
      'speech-02-turbo',
    ],
  },
  {
    key: 'doubao-speech',
    pages: [
      {
        // 官方模型目录页：汇总各产品线的可用模型。页面用产品名和版本（「TTS 2.0」
        // 「Seed Audio 1.0」）而不是 API 模型 ID，抽取时按「产品名 + 版本」合成候选。
        url: 'https://docs.volcengine.com/docs/6561/2499930',
        role: 'list',
        channel: 'doubao-speech',
      },
    ],
    unlisted: [
      // 1.0 代际：官方模型目录页与 TTS 接口页当前都只列 2.0 代际的资源 ID
      // （seed-tts-2.0 / seed-icl-2.0），1.0 只留给历史音色继续合成，
      // 已按接口核实过这两个 ID 仍可调用。
      'seed-tts-1.0',
      'seed-icl-1.0',
    ],
  },
  {
    key: 'openai',
    pages: [
      { url: 'https://developers.openai.com/api/docs/models', role: 'list', channel: 'openai' },
      { url: 'https://developers.openai.com/api/docs/deprecations', role: 'deprecation' },
    ],
    // OpenAI 的语音与研究模型 ID 不带版本号（gpt-transcribe、gpt-rosalind-research 等）。
    digitless: ['gpt'],
    skipped: [
      // 2026-11-11 逐个核对官方列表页后分组；要接的从这里删掉再写声明，新增条目写明不接的原因。
      // 旧版本：已声明 gpt-6 / gpt-6.1 系列
      'gpt-5.2',
      'gpt-5.2-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-pro',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-6-sol',
      // 需单独申请权限的安全研究模型
      'gpt-5.6-cyber',
      'gpt-6-cyber',
      // 实时 / 音频对话，不在支持的能力内
      'gpt-audio-1.5',
      'gpt-live-1',
      'gpt-live-1.1',
      'gpt-realtime-1.5',
      'gpt-realtime-2',
      'gpt-realtime-2.1',
      'gpt-realtime-2.1-mini',
      // 开放权重模型，平台不提供托管调用
      'gpt-oss-120b',
      'gpt-oss-20b',
      // 2026-11-14 补上 digitless 后新报出的模型（ID 不带版本号，默认候选规则看不见）。
      // 语音转写与实时翻译：modelbay 还没有 OpenAI 的转写 / 实时语音能力
      'gpt-transcribe',
      'gpt-live-transcribe',
      'gpt-realtime-whisper',
      'gpt-realtime-translate',
      // 需单独申请权限的生命科学推理模型
      'gpt-rosalind-research',
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
  'deepseek.com',
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
