import type { ModelDeclaration } from '@modelbay/core'

export default {
  canonicalId: 'volc/doubao-seed-evolving',
  id: 'doubao-seed-evolving',
  title: 'Doubao Seed Evolving（快速迭代）',
  capabilities: ['text.chat'],
  features: ['tools', 'vision', 'structured'],
  // 上下文窗口与最大输出：按量渠道见 https://docs.volcengine.com/docs/ark/model-list?lang=zh「doubao-seed-evolving」行，
  // 写「上下文窗口: 1024k」「最大回答: 256k」；套餐渠道见
  // https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview「支持模型及 Harness」表，写「上下文窗口：1024k」「最大输出：256k」。两个渠道一致，2026-11-07 核对原文。
  // 方舟文档的 k 未定义进制，按 1000 换算（1024k 记 1024000）。
  contextWindow: 1024000,
  maxOutputTokens: 256000,
  // 联网搜索与续接响应走 Responses API（POST /responses，按量渠道），字段与取值范围来自：
  // - 创建模型响应 tools（web_search）/ previous_response_id / max_tool_calls：
  //   https://docs.volcengine.com/docs/82379/1569618
  // - 联网搜索工具：https://docs.volcengine.com/docs/82379/1756990
  // - 支持的模型：https://docs.volcengine.com/docs/ark/model-list?lang=zh「工具调用能力」表，该模型的「联网内容插件」一列为 ✓
  // 以上均于 2026-11-06 核对原文。
  optionsSchema: {
    type: 'object',
    properties: {
      web_search: {
        title: '联网搜索',
        type: 'object',
        description:
          '启用 Responses API 的 web_search 工具；传空对象即用默认设置。需先在方舟控制台开通联网内容插件或豆包搜索。',
        properties: {
          limit: {
            title: '最大结果数',
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: '每轮搜索最大返回结果数量，官方默认 10',
          },
          max_keyword: {
            title: '最大关键词数',
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: '最大并行搜索关键词数量',
          },
          sources: {
            title: '搜索来源',
            type: 'array',
            items: {
              type: 'string',
              enum: ['toutiao', 'douyin', 'moji', 'search_engine', 'doubao'],
            },
            description:
              '限制可检索的信息来源；doubao 不能与其他来源同时配置，传 ["doubao"] 时 limit、max_keyword、user_location 不生效',
          },
          user_location: {
            title: '用户位置',
            type: 'object',
            description: '用于搜索优化的用户地理位置',
            properties: {
              type: { title: '位置类型', type: 'string', enum: ['approximate'] },
              city: { title: '城市', type: 'string' },
              country: { title: '国家', type: 'string' },
              region: { title: '地区', type: 'string' },
              timezone: { title: '时区', type: 'number' },
            },
            required: ['type'],
          },
        },
      },
      previous_response_id: {
        title: '上轮响应 ID',
        type: 'string',
        description:
          '上一个模型回复的 ID，用于多轮对话；会带入上一轮的输入和回答，本次输入 token 相应增加。连续请求之间官方建议间隔约 100 毫秒',
      },
      max_tool_calls: {
        title: '最大工具调用轮次',
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: '最大工具调用轮次，尽力而为；web_search 默认 3',
      },
    },
  },
  channels: [
    { channel: 'ark', id: 'doubao-seed-evolving' },
    {
      channel: 'ark-plan',
      id: 'doubao-seed-evolving',
      title: 'doubao-seed-evolving',
      description: 'Agent Plan 套餐文本模型，仅用于内置 Agent；可用性取决于套餐档位',
      agentOnly: true,
      omitOptions: ['web_search', 'previous_response_id', 'max_tool_calls'],
      source: {
        url: 'https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview',
        checkedAt: '2026-11-05',
      },
    },
  ],
  aliases: { official: [], short: [] },
  lifecycle: {
    status: 'active',
    source: {
      url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
      checkedAt: '2026-11-05',
    },
  },
  source: {
    url: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh',
    checkedAt: '2026-11-07',
  },
} satisfies ModelDeclaration
