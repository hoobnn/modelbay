/**
 * 工具的结构化元数据（能力 / native 操作 / 本地处理器 / 分组 / 别名）。
 * 这里只放「结构性」映射，不含任何模型 ID、上下限、默认值或生命周期字符串：
 * 那部分一律由 src/derive.ts 从 ModelDeclaration + core schema 函数派生。
 *
 * 工具名跨平台统一；MiniMax 的历史别名通过 ALIASES 额外注册一个统一命名的工具，
 * 既满足「同名统一」又保留兼容（见 docs/mcp-tool-diff.md）。
 */
import type { LocalHandler, PlatformKey, ToolGroup, ToolNature } from './types'

/** 归一化能力（0003），用于模型参数派生与 submit 路由。 */
const TOOL_CAPABILITY: Record<string, string> = {
  chat: 'text.chat',
  embed: 'text.embed',
  generate_image: 'image.generate',
  text_to_image: 'image.generate',
  generate_video: 'video.generate',
  edit_video: 'video.generate',
  text_to_speech: 'audio.speech',
  text_to_audio: 'audio.speech',
  generate_audio: 'audio.music',
  music_generation: 'audio.music',
  speech_to_text: 'audio.transcribe',
  clone_voice: 'voice.clone',
  voice_clone: 'voice.clone',
  design_voice: 'voice.design',
  voice_design: 'voice.design',
}

/** 单平台独有的能力，走 adapter.native(op, params)。op 名尽量对齐 0003 的 NATIVE_OPERATIONS。 */
const TOOL_NATIVE: Record<string, string> = {
  create_h3_context_ir_task: 'context-ir',
  animate_portrait: 'digital-human-lipsync',
  rerank: 'rerank',
  regenerate_video: 'video-2k-rerender',
  generate_podcast: 'podcast',
  interpret_audio: 'simultaneous-interpretation',
  translate_text: 'translation',
  summarize_meeting: 'meeting-notes',
  speech_console: 'console-management',
  manage_word_table: 'hotword-table',
  speech_raw_request: 'raw-request',
  delete_video_task: 'video-task-delete',
  list_video_tasks: 'video-task-list',
  query_video_generation: 'video-task-query',
  upload_file: 'file-upload',
  open_realtime_session: 'realtime-open',
  send_realtime_event: 'realtime-send',
  receive_realtime_events: 'realtime-receive',
  close_realtime_session: 'realtime-close',
  upgrade_voice: 'voice-upgrade',
}

/** MCP 本地工具：不联网、不需要 key，由 server 直接从生成结果 / 声明回答。 */
const TOOL_LOCAL: Record<string, LocalHandler> = {
  get_tool_help: 'tool-help',
  list_capabilities: 'capabilities',
  list_speech_capabilities: 'capabilities',
  get_speech_usage_examples: 'usage-examples',
  list_models: 'models',
  list_jobs: 'jobs',
  get_job: 'jobs',
  recover_job: 'jobs',
  get_voice: 'voices',
  list_voices: 'voices',
}

/** 操作性质覆盖：annotations 四个 hint 全部从性质派生，不照抄基线。 */
const NATURE_OVERRIDES: Record<string, ToolNature> = {
  // 本地只读
  get_tool_help: 'local',
  list_capabilities: 'local',
  list_speech_capabilities: 'local',
  get_speech_usage_examples: 'local',
  list_models: 'local',
  list_jobs: 'local',
  'models:list': 'local',
  // 查询（联网但只读、幂等）
  get_job: 'query',
  recover_job: 'query',
  get_voice: 'query',
  list_voices: 'query',
  list_video_tasks: 'query',
  query_video_generation: 'query',
  rerank: 'query',
  // 破坏性 / 管理
  delete_video_task: 'mutate',
  close_realtime_session: 'mutate',
  manage_word_table: 'mutate',
  speech_console: 'mutate',
  upgrade_voice: 'mutate',
  // 实时会话
  open_realtime_session: 'realtime',
  send_realtime_event: 'realtime',
  receive_realtime_events: 'realtime',
}

/** 工具组覆盖：实时会话、管理工具、需 node: 的能力默认不启用。 */
const GROUP_OVERRIDES: Record<string, ToolGroup> = {
  // realtime
  open_realtime_session: 'realtime',
  send_realtime_event: 'realtime',
  receive_realtime_events: 'realtime',
  close_realtime_session: 'realtime',
  // management
  delete_video_task: 'management',
  list_video_tasks: 'management',
  manage_word_table: 'management',
  speech_console: 'management',
  upgrade_voice: 'management',
  speech_raw_request: 'management',
  regenerate_video: 'management',
  // node（需 node: 可选子路径）
  upload_file: 'node',
}

/** 平台特有的组覆盖（同名工具在不同平台可归不同组）。 */
const PLATFORM_GROUP_OVERRIDES: Partial<Record<PlatformKey, Record<string, ToolGroup>>> = {}

/** MiniMax 历史别名：保留兼容，并补足一份跨平台统一命名的工具。 */
export const ALIASES: Record<string, string[]> = {
  text_to_audio: ['text_to_speech'],
  text_to_image: ['generate_image'],
  voice_clone: ['clone_voice'],
  voice_design: ['design_voice'],
}

/** 超出基线的新工具：从声明派生可用模型与生命周期，避免客户端硬编码模型清单。 */
export const EXTRA_TOOL_NAMES = ['models:list'] as const

export interface ToolMeta {
  capability?: string
  nativeOp?: string
  localHandler?: LocalHandler
  nature: ToolNature
  group: ToolGroup
  aliases: string[]
}

export function deriveMeta(platform: PlatformKey, name: string): ToolMeta {
  const platformGroup = PLATFORM_GROUP_OVERRIDES[platform]?.[name]
  return {
    ...(TOOL_CAPABILITY[name] ? { capability: TOOL_CAPABILITY[name] } : {}),
    ...(TOOL_NATIVE[name] ? { nativeOp: TOOL_NATIVE[name] } : {}),
    ...(TOOL_LOCAL[name] ? { localHandler: TOOL_LOCAL[name] } : {}),
    nature: NATURE_OVERRIDES[name] ?? 'generate',
    group: platformGroup ?? GROUP_OVERRIDES[name] ?? 'core',
    aliases: ALIASES[name] ?? [],
  }
}

/** 供文档/测试使用：某工具是否被分到可选组。 */
export function isOptionalGroup(group: ToolGroup): boolean {
  return group !== 'core'
}
