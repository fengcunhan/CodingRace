import { z } from 'zod'

// 协议契约见 docs/design/event-schema-and-database.md §2。
// 本包被插件与服务端共同引用，是双方唯一的协议来源。
// 隐私约束：所有对象走 zod 默认 strip 行为，未知字段（cwd/prompt/路径等）在解析时剥离。

export const SCHEMA_VERSION = 1
export const MAX_EVENTS_PER_BATCH = 100
export const MAX_TOKENS_PER_EVENT = 50_000_000

export const AGENTS = ['claude_code', 'codex', 'gemini_cli', 'other'] as const
export const agentSchema = z.enum(AGENTS)
export type Agent = z.infer<typeof agentSchema>

// 服务端拒收原因的既定词表；服务端可扩展，客户端不得据 reason 分支重试逻辑
export const REJECTION_REASONS = [
  'invalid_event',
  'occurred_at_in_future',
  'implausible_value',
  'unsupported_in_phase1',
] as const

const tokenCount = z.number().int().min(0).max(MAX_TOKENS_PER_EVENT)
const shortString = (max: number) => z.string().min(1).max(max)
const isoDatetime = z.iso.datetime({ offset: true })

export const usageCountsSchema = z.object({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  cache_creation_tokens: tokenCount,
  cache_read_tokens: tokenCount,
})
export type UsageCounts = z.infer<typeof usageCountsSchema>

const eventBase = {
  event_id: z.uuid(),
  agent: agentSchema,
  session_id: shortString(200),
  model_raw: shortString(200),
  usage: usageCountsSchema,
  occurred_at: isoDatetime,
  turn_duration_ms: z.number().int().positive().max(86_400_000).optional(),
}

export const usageEventSchema = z.object({
  ...eventBase,
  event_type: z.literal('usage'),
  message_id: shortString(200),
  period_start: z.null().optional(),
})
export type UsageEvent = z.infer<typeof usageEventSchema>

export const usageSummaryEventSchema = z.object({
  ...eventBase,
  event_type: z.literal('usage_summary'),
  message_id: z.null().optional(),
  period_start: isoDatetime,
})
export type UsageSummaryEvent = z.infer<typeof usageSummaryEventSchema>

export const reportEventSchema = z
  .discriminatedUnion('event_type', [usageEventSchema, usageSummaryEventSchema])
  .superRefine((event, ctx) => {
    if (
      event.event_type === 'usage_summary' &&
      new Date(event.period_start).getTime() > new Date(event.occurred_at).getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'period_start must not be after occurred_at',
        path: ['period_start'],
      })
    }
  })
export type ReportEvent = z.infer<typeof reportEventSchema>

export const clientInfoSchema = z.object({
  plugin_name: shortString(100),
  plugin_version: shortString(50),
  agent: agentSchema,
  agent_version: z.string().max(50).optional(),
  os: z.string().max(50).optional(),
  arch: z.string().max(50).optional(),
})
export type ClientInfo = z.infer<typeof clientInfoSchema>

// 外层信封：服务端先用它校验批次结构，再对 events 逐条 safeParse，
// 以便对同一批次返回逐条 accepted/duplicate/rejected（§2.4 部分成功语义）
export const ingestEnvelopeBaseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  batch_id: z.uuid(),
  client: clientInfoSchema,
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
})
export type IngestEnvelopeBase = z.infer<typeof ingestEnvelopeBaseSchema>

// 完整信封：客户端发送前的自校验入口
export const ingestEnvelopeSchema = ingestEnvelopeBaseSchema.extend({
  events: z.array(reportEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
})
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>

export const eventResultSchema = z.object({
  event_id: z.uuid(),
  status: z.enum(['accepted', 'duplicate', 'rejected']),
  reason: z.string().optional(),
})
export type EventResult = z.infer<typeof eventResultSchema>

export const ingestResponseSchema = z.object({
  batch_id: z.uuid(),
  results: z.array(eventResultSchema),
})
export type IngestResponse = z.infer<typeof ingestResponseSchema>
