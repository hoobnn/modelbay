/**
 * 同传协议的最小 protobuf 编解码。
 *
 * 官方定义在 `data.speech.ast.TranslateRequest` / `TranslateResponse`，
 * 这里只实现同传链路用到的字段，不引入第三方 protobuf 库：
 * - 写：request_meta / event / user / source_audio / target_audio / request / denoise；
 * - 读：response_meta / event / data / text / start_time / end_time / spk_chg / usage。
 *
 * 字段号与官方 .proto 一致（data.speech.common.RequestMeta、data.speech.understanding.*）。
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 事件号（data.speech.event.Type）。 */
export const AST_EVENT = {
  None: 0,
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  UsageResponse: 154,
  TaskRequest: 200,
  TTSResponse: 352,
  SourceSubtitleStart: 650,
  SourceSubtitleResponse: 651,
  SourceSubtitleEnd: 652,
  TranslationSubtitleStart: 653,
  TranslationSubtitleResponse: 654,
  TranslationSubtitleEnd: 655,
} as const

function varint(value: number): number[] {
  let rest = value >>> 0
  const out: number[] = []
  while (rest > 127) {
    out.push((rest & 127) | 128)
    rest >>>= 7
  }
  out.push(rest)
  return out
}

function tag(field: number, wire: number): number[] {
  return varint(field * 8 + wire)
}

function lengthDelimited(field: number, payload: Uint8Array): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload]
}

function stringField(field: number, value: string): number[] {
  return lengthDelimited(field, encoder.encode(value))
}

function bytesField(field: number, value: Uint8Array): number[] {
  return lengthDelimited(field, value)
}

function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)]
}

function boolField(field: number, value: boolean): number[] {
  return varintField(field, value ? 1 : 0)
}

export interface AstRequestMeta {
  endpoint?: string
  appKey?: string
  appId?: string
  resourceId?: string
  connectionId?: string
  sessionId?: string
  sequence?: number
}

export interface AstUser {
  uid?: string
  did?: string
  platform?: string
  sdkVersion?: string
  appVersion?: string
}

export interface AstAudio {
  data?: string
  url?: string
  urlType?: string
  format?: string
  codec?: string
  language?: string
  rate?: number
  bits?: number
  channel?: number
  binaryData?: Uint8Array
}

export interface AstCorpus {
  /** 热词列表（官方 Corpus.hot_words_list）。 */
  hotWords?: string[]
  /** 术语表（官方 Corpus.glossary_list）。 */
  glossary?: { key: string; value: string }[]
}

export interface AstReqParams {
  mode?: string
  sourceLanguage?: string
  targetLanguage?: string
  speakerId?: string
  speechRate?: number
  enableSourceLanguageDetect?: boolean
  isCustomSpeaker?: boolean
  ttsResourceId?: string
  /** 官方 Corpus（热词与术语表）。 */
  corpus?: AstCorpus
}

export interface TranslateRequestFields {
  requestMeta?: AstRequestMeta
  event?: number
  user?: AstUser
  sourceAudio?: AstAudio
  targetAudio?: AstAudio
  request?: AstReqParams
  denoise?: boolean
}

function encodeRequestMeta(meta: AstRequestMeta): number[] {
  const out: number[] = []
  if (meta.endpoint) out.push(...stringField(1, meta.endpoint))
  if (meta.appKey) out.push(...stringField(2, meta.appKey))
  if (meta.appId) out.push(...stringField(3, meta.appId))
  if (meta.resourceId) out.push(...stringField(4, meta.resourceId))
  if (meta.connectionId) out.push(...stringField(5, meta.connectionId))
  if (meta.sessionId) out.push(...stringField(6, meta.sessionId))
  if (meta.sequence !== undefined) out.push(...varintField(7, meta.sequence))
  return out
}

function encodeUser(user: AstUser): number[] {
  const out: number[] = []
  if (user.uid) out.push(...stringField(1, user.uid))
  if (user.did) out.push(...stringField(2, user.did))
  if (user.platform) out.push(...stringField(3, user.platform))
  if (user.sdkVersion) out.push(...stringField(4, user.sdkVersion))
  if (user.appVersion) out.push(...stringField(5, user.appVersion))
  return out
}

function encodeAudio(audio: AstAudio): number[] {
  const out: number[] = []
  if (audio.data) out.push(...stringField(1, audio.data))
  if (audio.url) out.push(...stringField(2, audio.url))
  if (audio.urlType) out.push(...stringField(3, audio.urlType))
  if (audio.format) out.push(...stringField(4, audio.format))
  if (audio.codec) out.push(...stringField(5, audio.codec))
  if (audio.language) out.push(...stringField(6, audio.language))
  if (audio.rate !== undefined) out.push(...varintField(7, audio.rate))
  if (audio.bits !== undefined) out.push(...varintField(8, audio.bits))
  if (audio.channel !== undefined) out.push(...varintField(9, audio.channel))
  if (audio.binaryData) out.push(...bytesField(14, audio.binaryData))
  return out
}

function encodeCorpus(corpus: AstCorpus): number[] {
  const out: number[] = []
  for (const word of corpus.hotWords ?? []) out.push(...stringField(9, word))
  for (const item of corpus.glossary ?? []) {
    const entry = [...stringField(1, item.key), ...stringField(2, item.value)]
    out.push(...lengthDelimited(10, Uint8Array.from(entry)))
  }
  return out
}

function encodeReqParams(params: AstReqParams): number[] {
  const out: number[] = []
  if (params.mode) out.push(...stringField(1, params.mode))
  if (params.sourceLanguage) out.push(...stringField(2, params.sourceLanguage))
  if (params.targetLanguage) out.push(...stringField(3, params.targetLanguage))
  if (params.speakerId) out.push(...stringField(4, params.speakerId))
  if (params.speechRate !== undefined) out.push(...varintField(5, params.speechRate))
  if (params.enableSourceLanguageDetect !== undefined)
    out.push(...boolField(6, params.enableSourceLanguageDetect))
  if (params.isCustomSpeaker !== undefined) out.push(...boolField(7, params.isCustomSpeaker))
  if (params.ttsResourceId) out.push(...stringField(8, params.ttsResourceId))
  if (params.corpus) out.push(...lengthDelimited(100, Uint8Array.from(encodeCorpus(params.corpus))))
  return out
}

/** 序列化成官方的 TranslateRequest 字节。 */
export function encodeTranslateRequest(input: TranslateRequestFields): Uint8Array {
  const out: number[] = []
  if (input.requestMeta)
    out.push(...lengthDelimited(1, Uint8Array.from(encodeRequestMeta(input.requestMeta))))
  if (input.event !== undefined) out.push(...varintField(2, input.event))
  if (input.user) out.push(...lengthDelimited(3, Uint8Array.from(encodeUser(input.user))))
  if (input.sourceAudio)
    out.push(...lengthDelimited(4, Uint8Array.from(encodeAudio(input.sourceAudio))))
  if (input.targetAudio)
    out.push(...lengthDelimited(5, Uint8Array.from(encodeAudio(input.targetAudio))))
  if (input.request)
    out.push(...lengthDelimited(6, Uint8Array.from(encodeReqParams(input.request))))
  if (input.denoise !== undefined) out.push(...boolField(7, input.denoise))
  return Uint8Array.from(out)
}

/** 解码出来的字段（按字段号分组）。 */
type DecodedFields = Map<number, (number | Uint8Array)[]>

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let index = offset
  while (index < bytes.length) {
    const byte = bytes[index]!
    value += (byte & 127) * 2 ** shift
    index += 1
    if ((byte & 128) === 0) return { value, next: index }
    shift += 7
    if (shift > 63) throw new Error('varint 过长')
  }
  throw new Error('varint 未结束')
}

function decodeFields(bytes: Uint8Array): DecodedFields {
  const out: DecodedFields = new Map()
  let offset = 0
  while (offset < bytes.length) {
    const { value: key, next } = readVarint(bytes, offset)
    offset = next
    const field = Math.floor(key / 8)
    const wire = key & 7
    if (field === 0) throw new Error('字段号不能为 0')
    if (wire === 0) {
      const read = readVarint(bytes, offset)
      offset = read.next
      push(out, field, read.value)
    } else if (wire === 1) {
      if (offset + 8 > bytes.length) throw new Error('64 位字段被截断')
      offset += 8
    } else if (wire === 2) {
      const read = readVarint(bytes, offset)
      offset = read.next
      const end = offset + read.value
      if (end > bytes.length) throw new Error('长度字段被截断')
      push(out, field, bytes.subarray(offset, end))
      offset = end
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) throw new Error('32 位字段被截断')
      offset += 4
    } else {
      throw new Error(`未知的 wire type ${wire}`)
    }
  }
  return out
}

function push(fields: DecodedFields, field: number, value: number | Uint8Array): void {
  const list = fields.get(field)
  if (list) list.push(value)
  else fields.set(field, [value])
}

function firstString(fields: DecodedFields, field: number): string | undefined {
  const value = fields.get(field)?.[0]
  if (typeof value === 'string') return value
  // 长度分隔的字段解出来是字节，字符串按 UTF-8 读。
  if (value instanceof Uint8Array) return decoder.decode(value)
  return undefined
}

function firstBytes(fields: DecodedFields, field: number): Uint8Array | undefined {
  const value = fields.get(field)?.[0]
  return value instanceof Uint8Array ? value : undefined
}

function firstNumber(fields: DecodedFields, field: number): number | undefined {
  const value = fields.get(field)?.[0]
  return typeof value === 'number' ? value : undefined
}

/** 官方 Billing 消息的字段名（data.speech.common.Billing）。 */
const BILLING_FIELDS: Record<number, string> = {
  1: 'items',
  2: 'duration_msec',
  3: 'word_count',
}

/** 把解出来的字段还原成普通对象，字段名用官方的。 */
function toPlain(fields: DecodedFields, names?: Record<number, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, values] of fields) {
    const name = names?.[field] ?? String(field)
    const list = values.map((value) =>
      value instanceof Uint8Array ? decoder.decode(value) : value,
    )
    out[name] = list.length === 1 ? list[0] : list
  }
  return out
}

export interface TranslateResponseFields {
  sessionId?: string
  statusCode?: number
  message?: string
  billing?: Record<string, unknown>
  event?: number
  data?: Uint8Array
  text?: string
  startTime?: number
  endTime?: number
  speakerChanged?: boolean
  mutedDurationMs?: number
  speakerId?: string
  detectedLanguage?: string
  languageConfidence?: number
}

/** 解码官方的 TranslateResponse 字节。 */
export function decodeTranslateResponse(bytes: Uint8Array): TranslateResponseFields {
  const fields = decodeFields(bytes)
  const meta = fields.get(1)?.[0]
  const metaFields = meta instanceof Uint8Array ? decodeFields(meta) : new Map()
  const billing = metaFields.get(5)?.[0]
  return {
    ...(firstString(metaFields, 1) !== undefined ? { sessionId: firstString(metaFields, 1) } : {}),
    ...(firstNumber(metaFields, 3) !== undefined ? { statusCode: firstNumber(metaFields, 3) } : {}),
    ...(firstString(metaFields, 4) !== undefined ? { message: firstString(metaFields, 4) } : {}),
    ...(billing instanceof Uint8Array
      ? { billing: toPlain(decodeFields(billing), BILLING_FIELDS) }
      : {}),
    ...(firstNumber(fields, 2) !== undefined ? { event: firstNumber(fields, 2) } : {}),
    ...(firstBytes(fields, 3) ? { data: firstBytes(fields, 3) } : {}),
    ...(firstString(fields, 4) !== undefined ? { text: firstString(fields, 4) } : {}),
    ...(firstNumber(fields, 5) !== undefined ? { startTime: firstNumber(fields, 5) } : {}),
    ...(firstNumber(fields, 6) !== undefined ? { endTime: firstNumber(fields, 6) } : {}),
    ...(firstNumber(fields, 7) !== undefined
      ? { speakerChanged: firstNumber(fields, 7) === 1 }
      : {}),
    ...(firstNumber(fields, 8) !== undefined ? { mutedDurationMs: firstNumber(fields, 8) } : {}),
    ...(firstString(fields, 9) !== undefined ? { speakerId: firstString(fields, 9) } : {}),
    ...(firstString(fields, 10) !== undefined ? { detectedLanguage: firstString(fields, 10) } : {}),
    ...(firstNumber(fields, 11) !== undefined
      ? { languageConfidence: firstNumber(fields, 11) }
      : {}),
  }
}

/** 解码客户端发出的 TranslateRequest（自测与排障用）。 */
export function decodeTranslateRequest(bytes: Uint8Array): TranslateRequestFields {
  const fields = decodeFields(bytes)
  const meta = fields.get(1)?.[0]
  const metaFields = meta instanceof Uint8Array ? decodeFields(meta) : new Map()
  const user = fields.get(3)?.[0]
  const userFields = user instanceof Uint8Array ? decodeFields(user) : new Map()
  const source = fields.get(4)?.[0]
  const sourceFields = source instanceof Uint8Array ? decodeFields(source) : new Map()
  const target = fields.get(5)?.[0]
  const targetFields = target instanceof Uint8Array ? decodeFields(target) : new Map()
  const request = fields.get(6)?.[0]
  const requestFields = request instanceof Uint8Array ? decodeFields(request) : new Map()
  const corpus = requestFields.get(100)?.[0]
  const corpusFields = corpus instanceof Uint8Array ? decodeFields(corpus) : new Map()
  const glossary: { key: string; value: string }[] = []
  for (const entry of (corpusFields.get(10) ?? []) as (number | Uint8Array)[]) {
    if (!(entry instanceof Uint8Array)) continue
    const item = decodeFields(entry)
    glossary.push({
      key: firstString(item, 1) ?? '',
      value: firstString(item, 2) ?? '',
    })
  }
  return {
    requestMeta: {
      ...(firstString(metaFields, 6) !== undefined
        ? { sessionId: firstString(metaFields, 6) }
        : {}),
      ...(firstString(metaFields, 4) !== undefined
        ? { resourceId: firstString(metaFields, 4) }
        : {}),
      ...(firstString(metaFields, 5) !== undefined
        ? { connectionId: firstString(metaFields, 5) }
        : {}),
    },
    ...(firstNumber(fields, 2) !== undefined ? { event: firstNumber(fields, 2) } : {}),
    user: {
      ...(firstString(userFields, 1) !== undefined ? { uid: firstString(userFields, 1) } : {}),
    },
    sourceAudio: {
      ...(firstString(sourceFields, 4) !== undefined
        ? { format: firstString(sourceFields, 4) }
        : {}),
      ...(firstString(sourceFields, 5) !== undefined
        ? { codec: firstString(sourceFields, 5) }
        : {}),
      ...(firstNumber(sourceFields, 7) !== undefined ? { rate: firstNumber(sourceFields, 7) } : {}),
      ...(firstNumber(sourceFields, 8) !== undefined ? { bits: firstNumber(sourceFields, 8) } : {}),
      ...(firstNumber(sourceFields, 9) !== undefined
        ? { channel: firstNumber(sourceFields, 9) }
        : {}),
      ...(firstBytes(sourceFields, 14) ? { binaryData: firstBytes(sourceFields, 14) } : {}),
    },
    targetAudio: {
      ...(firstString(targetFields, 4) !== undefined
        ? { format: firstString(targetFields, 4) }
        : {}),
      ...(firstNumber(targetFields, 7) !== undefined ? { rate: firstNumber(targetFields, 7) } : {}),
      ...(firstNumber(targetFields, 8) !== undefined ? { bits: firstNumber(targetFields, 8) } : {}),
      ...(firstNumber(targetFields, 9) !== undefined
        ? { channel: firstNumber(targetFields, 9) }
        : {}),
    },
    request: {
      ...(firstString(requestFields, 1) !== undefined
        ? { mode: firstString(requestFields, 1) }
        : {}),
      ...(firstString(requestFields, 2) !== undefined
        ? { sourceLanguage: firstString(requestFields, 2) }
        : {}),
      ...(firstString(requestFields, 3) !== undefined
        ? { targetLanguage: firstString(requestFields, 3) }
        : {}),
      ...(firstString(requestFields, 8) !== undefined
        ? { ttsResourceId: firstString(requestFields, 8) }
        : {}),
      ...(corpusFields.size
        ? {
            corpus: {
              hotWords: ((corpusFields.get(9) ?? []) as (number | Uint8Array)[]).map((item) =>
                item instanceof Uint8Array ? decoder.decode(item) : String(item),
              ),
              glossary,
            },
          }
        : {}),
    },
    ...(firstNumber(fields, 7) !== undefined ? { denoise: firstNumber(fields, 7) === 1 } : {}),
  }
}

/** 文本转 bytes 的小工具（测试与日志用）。 */
export function toBytes(text: string): Uint8Array {
  return encoder.encode(text)
}

/** bytes 转文本。 */
export function fromBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}
