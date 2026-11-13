/** DeepSeek 具名服务工具。无 model 参数的服务不派生虚构的模型目录。 */
import type { ToolSpec, ToolNature } from '@modelbay/core'

const object = { type: 'object', additionalProperties: true }
const file = {
  type: 'object',
  description: 'SDK AssetRef，或 { base64: "文件的 base64 内容" }；不在工具内读取任意本地路径。',
  additionalProperties: true,
}
function nativeTool(
  name: string,
  op: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
  nature: ToolNature = 'generate',
): ToolSpec {
  return {
    name,
    native: op,
    nature,
    description,
    ...(nature === 'mutate' || op === 'upload-file' ? { group: 'management' as const } : {}),
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  }
}
const binary = { file, filename: { type: 'string' }, mime: { type: 'string' } }
const filePurpose = {
  type: 'string',
  enum: ['user_data', 'text_recognition', 'rich_layout_recognition'],
}

export const deepseekTools: ToolSpec[] = [
  {
    name: 'chat',
    capability: 'text.chat',
    description:
      'DeepSeek 对话、视觉理解、思考与函数工具调用。history 不含当前 prompt；完整协议和文件引用也可用具名 JSON 工具。parameters 传递平台 extra 参数。',
    mapArguments(args) {
      const { parameters, ...rest } = args
      const extra: Record<string, unknown> = {
        ...(parameters && typeof parameters === 'object' ? parameters : {}),
      }
      const kept: Record<string, unknown> = {}
      const common = [
        'messages',
        'tools',
        'toolChoice',
        'jsonSchema',
        'prompt',
        'model',
        'system',
        'history',
        'images',
        'max_tokens',
        'temperature',
        'wait',
        'out_dir',
        'output_directory',
      ]
      for (const [key, value] of Object.entries(rest)) {
        if (common.includes(key)) kept[key] = value
        else extra[key] = value
      }
      return { ...kept, ...(Object.keys(extra).length ? { extra } : {}) }
    },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        system: { type: 'string' },
        history: { type: 'array', items: object },
        images: { type: 'array', items: { type: 'string' } },
        max_tokens: { type: 'integer' },
        temperature: { type: 'number' },
        parameters: object,
      },
      required: ['prompt'],
    },
  },
  nativeTool(
    'search_web',
    'search',
    '通过 DeepSeek 搜索引擎搜索网页；按次计费。',
    {
      query: { type: 'string' },
      count: { type: 'integer' },
      ori_question: { type: ['string', 'null'] },
      localization: { type: 'string' },
      need_content: { type: 'boolean' },
    },
    ['query'],
    'query',
  ),
  nativeTool(
    'fetch_url',
    'fetch-url',
    '通过 DeepSeek 读取 HTTP(S) 网页并返回 Markdown；按次计费。',
    { url: { type: 'string' } },
    ['url'],
    'query',
  ),
  nativeTool(
    'recognize_document',
    'ocr',
    '独立 OCR：PDF、Office 文档或图片逐页识别；返回原始页结果与截断标志，按页计费。',
    {
      ...binary,
      purpose: { type: 'string', enum: ['text_recognition', 'rich_layout_recognition'] },
    },
    ['file', 'filename', 'purpose'],
  ),
  nativeTool(
    'synthesize_speech',
    'tts',
    '独立 TTS，无模型 ID。返回 WAV/PCM 音频；out_dir 可保存文件。',
    {
      text: { type: 'string' },
      voice_id: { type: 'string' },
      format: { type: 'string' },
      filter_markdown: { type: 'boolean' },
      out_dir: { type: 'string' },
    },
    ['text'],
  ),
  nativeTool(
    'transcribe_speech',
    'asr',
    '独立 ASR，无模型 ID。上传完整 PCM WAV/Ogg Opus，返回文本与时长；语言自动检测。',
    binary,
    ['file', 'filename'],
  ),
  nativeTool(
    'upload_file',
    'upload-file',
    '上传图片或文档供后续对话引用。PDF/Office 选择识别用途；文件存储会改变账户状态。',
    {
      ...binary,
      purpose: filePurpose,
      expires_after: object,
    },
    ['file', 'filename', 'purpose'],
    'mutate',
  ),
  nativeTool(
    'list_remote_files',
    'list-files',
    '查询账户文件，保留分页游标；可按用途筛选。',
    {
      after: { type: 'string' },
      limit: { type: 'integer' },
      order: { type: 'string' },
      purpose: filePurpose,
    },
    [],
    'query',
  ),
  nativeTool(
    'retrieve_file',
    'retrieve-file',
    '查询上传文件元数据；不下载原始文件。',
    { file_id: { type: 'string' } },
    ['file_id'],
    'query',
  ),
  nativeTool(
    'delete_file',
    'delete-file',
    '删除账户中的指定文件。',
    { file_id: { type: 'string' } },
    ['file_id'],
    'mutate',
  ),
  nativeTool('get_balance', 'user-balance', '查询 DeepSeek 账户余额。', {}, [], 'query'),
  nativeTool(
    'list_remote_models',
    'list-remote-models',
    '查询账户实时可用模型及服务端能力元数据。',
    {},
    [],
    'query',
  ),
  nativeTool(
    'create_response',
    'responses',
    '完整 Responses JSON 请求和响应，支持文件、联网工具、安全检查、标题等扩展；不接受 stream=true。',
    { body: object },
    ['body'],
  ),
  nativeTool(
    'create_message',
    'messages',
    '完整 Anthropic Messages JSON 请求和响应，保留 thinking、工具、引用和签名；不接受 stream=true。',
    { body: object },
    ['body'],
  ),
  nativeTool(
    'complete_fim',
    'fim',
    'Beta FIM 补全 JSON 请求，支持 prompt/suffix；不接受 stream=true。',
    { body: object },
    ['body'],
  ),
  nativeTool(
    'create_chat_completion',
    'chat-completions',
    '完整 Chat Completions JSON 请求和响应，支持文件、前缀补全与内置联网工具；不接受 stream=true。',
    { body: object },
    ['body'],
  ),
  {
    name: 'get_tool_help',
    description: '读取工具完整用法和声明限制。',
    inputSchema: { type: 'object', properties: { tool: { type: 'string' } }, required: ['tool'] },
  },
  {
    name: 'list_capabilities',
    description: '读取本地 DeepSeek 声明和平台能力。',
    inputSchema: { type: 'object', properties: {} },
  },
]
