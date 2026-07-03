import { describe, expect, it } from 'vitest'
import {
  MAX_EVENTS_PER_BATCH,
  MAX_TOKENS_PER_EVENT,
  ingestEnvelopeBaseSchema,
  ingestEnvelopeSchema,
  ingestResponseSchema,
  reportEventSchema,
} from '../src/index'

const EVENT_ID = '0197f3a2-9d0b-71c2-a3e4-5f6a7b8c9d0e'
const BATCH_ID = '0197f3a2-6c1e-7c9a-b1d4-8e2f5a6b7c8d'

function usageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: 'usage',
    agent: 'claude_code',
    session_id: 'session-uuid-1',
    message_id: 'req_011CRabc',
    model_raw: 'claude-sonnet-5',
    usage: {
      input_tokens: 1234,
      output_tokens: 5678,
      cache_creation_tokens: 0,
      cache_read_tokens: 183500,
    },
    occurred_at: '2026-07-03T08:12:33Z',
    turn_duration_ms: 45210,
    ...overrides,
  }
}

function summaryEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: 'usage_summary',
    agent: 'codex',
    session_id: 'rollout-file-1',
    model_raw: 'gpt-5-codex',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
    occurred_at: '2026-07-03T09:00:00Z',
    period_start: '2026-07-03T08:00:00Z',
    ...overrides,
  }
}

function envelope(events: unknown[]): Record<string, unknown> {
  return {
    schema_version: 1,
    batch_id: BATCH_ID,
    client: {
      plugin_name: 'codingrace-plugin',
      plugin_version: '0.1.0',
      agent: 'claude_code',
      agent_version: '2.1.34',
      os: 'darwin',
      arch: 'arm64',
    },
    events,
  }
}

describe('reportEventSchema — 合法事件', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['usage 事件（全字段）', usageEvent()],
    ['usage 事件（无可选字段）', usageEvent({ turn_duration_ms: undefined })],
    ['usage 事件（带时区偏移的时间戳）', usageEvent({ occurred_at: '2026-07-03T16:12:33+08:00' })],
    ['usage 事件（period_start 显式为 null）', usageEvent({ period_start: null })],
    ['usage_summary 事件', summaryEvent()],
    ['usage_summary 事件（message_id 显式为 null）', summaryEvent({ message_id: null })],
    ['token 数为上限边界值', usageEvent({ usage: { input_tokens: MAX_TOKENS_PER_EVENT, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } })],
  ]

  it.each(cases)('%s', (_name, event) => {
    const result = reportEventSchema.safeParse(event)
    expect(result.success, JSON.stringify(result.success ? '' : result.error.issues)).toBe(true)
  })
})

describe('reportEventSchema — 非法事件', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['usage 事件缺 message_id', usageEvent({ message_id: undefined })],
    ['usage 事件 message_id 为空串', usageEvent({ message_id: '' })],
    ['usage_summary 事件缺 period_start', summaryEvent({ period_start: undefined })],
    ['usage_summary 的 period_start 晚于 occurred_at', summaryEvent({ period_start: '2026-07-03T10:00:00Z' })],
    ['token 为负数', usageEvent({ usage: { input_tokens: -1, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } })],
    ['token 为小数', usageEvent({ usage: { input_tokens: 1.5, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } })],
    ['token 超过单事件上限', usageEvent({ usage: { input_tokens: MAX_TOKENS_PER_EVENT + 1, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } })],
    ['usage 缺字段', usageEvent({ usage: { input_tokens: 1, output_tokens: 2, cache_creation_tokens: 3 } })],
    ['event_id 非 UUID', usageEvent({ event_id: 'not-a-uuid' })],
    ['occurred_at 非 RFC3339', usageEvent({ occurred_at: '2026-07-03 08:12:33' })],
    ['occurred_at 仅日期', usageEvent({ occurred_at: '2026-07-03' })],
    ['agent 不在枚举内', usageEvent({ agent: 'cursor' })],
    ['event_type 未知', usageEvent({ event_type: 'heartbeat' })],
    ['session_id 为空串', usageEvent({ session_id: '' })],
    ['model_raw 为空串', usageEvent({ model_raw: '' })],
    ['turn_duration_ms 为 0', usageEvent({ turn_duration_ms: 0 })],
    ['turn_duration_ms 为负', usageEvent({ turn_duration_ms: -5 })],
  ]

  it.each(cases)('%s', (_name, event) => {
    expect(reportEventSchema.safeParse(event).success).toBe(false)
  })
})

describe('隐私：未知字段一律剥离', () => {
  it('事件层的未知字段（cwd/prompt 等）不会出现在解析结果中', () => {
    const dirty = usageEvent({
      cwd: '/Users/someone/company-secret-repo',
      prompt: 'do not leak me',
      hostname: 'work-laptop',
    })
    const result = reportEventSchema.safeParse(dirty)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('cwd')
      expect(result.data).not.toHaveProperty('prompt')
      expect(result.data).not.toHaveProperty('hostname')
    }
  })

  it('usage 对象内的未知字段同样被剥离', () => {
    const dirty = usageEvent({
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_tokens: 3,
        cache_read_tokens: 4,
        file_paths: ['/etc/passwd'],
      },
    })
    const result = reportEventSchema.safeParse(dirty)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.usage).not.toHaveProperty('file_paths')
    }
  })
})

describe('ingestEnvelopeSchema — 信封', () => {
  it('合法信封通过完整校验', () => {
    const result = ingestEnvelopeSchema.safeParse(envelope([usageEvent(), summaryEvent()]))
    expect(result.success).toBe(true)
  })

  it('空事件数组拒绝', () => {
    expect(ingestEnvelopeSchema.safeParse(envelope([])).success).toBe(false)
  })

  it(`超过 ${MAX_EVENTS_PER_BATCH} 条事件拒绝`, () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => usageEvent())
    expect(ingestEnvelopeSchema.safeParse(envelope(events)).success).toBe(false)
  })

  it(`恰好 ${MAX_EVENTS_PER_BATCH} 条事件通过`, () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => usageEvent())
    expect(ingestEnvelopeSchema.safeParse(envelope(events)).success).toBe(true)
  })

  it('schema_version 不匹配拒绝', () => {
    expect(
      ingestEnvelopeSchema.safeParse({ ...envelope([usageEvent()]), schema_version: 2 }).success
    ).toBe(false)
  })

  it('batch_id 非 UUID 拒绝', () => {
    expect(
      ingestEnvelopeSchema.safeParse({ ...envelope([usageEvent()]), batch_id: 'nope' }).success
    ).toBe(false)
  })

  it('client 缺 plugin_version 拒绝', () => {
    const bad = envelope([usageEvent()])
    bad.client = { plugin_name: 'codingrace-plugin', agent: 'claude_code' }
    expect(ingestEnvelopeSchema.safeParse(bad).success).toBe(false)
  })

  it('base 信封只校验外层：坏事件放行，交给服务端逐条判定', () => {
    const result = ingestEnvelopeBaseSchema.safeParse(envelope([{ totally: 'broken' }]))
    expect(result.success).toBe(true)
  })
})

describe('ingestResponseSchema — 响应', () => {
  it('合法响应（含部分成功）通过', () => {
    const result = ingestResponseSchema.safeParse({
      batch_id: BATCH_ID,
      results: [
        { event_id: EVENT_ID, status: 'accepted' },
        { event_id: EVENT_ID, status: 'duplicate' },
        { event_id: EVENT_ID, status: 'rejected', reason: 'occurred_at_in_future' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('未知 status 拒绝', () => {
    expect(
      ingestResponseSchema.safeParse({
        batch_id: BATCH_ID,
        results: [{ event_id: EVENT_ID, status: 'maybe' }],
      }).success
    ).toBe(false)
  })
})
