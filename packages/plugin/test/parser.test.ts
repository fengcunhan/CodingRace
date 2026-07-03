import { describe, expect, it } from 'vitest'
import { parseTranscriptChunk } from '../src/parser'

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

const assistantLine = (overrides: Record<string, unknown> = {}, message: Record<string, unknown> = {}) =>
  line({
    type: 'assistant',
    uuid: 'uuid-a1',
    timestamp: '2026-07-03T08:00:05.000Z',
    sessionId: 'sess-1',
    requestId: 'req_1',
    cwd: '/secret/project/path',
    message: {
      id: 'msg_01A',
      role: 'assistant',
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: 4,
        output_tokens: 120,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 30000,
      },
      ...message,
    },
    ...overrides,
  })

describe('parseTranscriptChunk', () => {
  it('提取 assistant 行的 usage 并映射为统一事件', () => {
    const events = parseTranscriptChunk(`${assistantLine()}\n`, 'fallback-sess')
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event).toMatchObject({
      event_type: 'usage',
      agent: 'claude_code',
      session_id: 'sess-1',
      message_id: 'req_1',
      model_raw: 'claude-sonnet-5',
      occurred_at: '2026-07-03T08:00:05.000Z',
      usage: {
        input_tokens: 4,
        output_tokens: 120,
        cache_creation_tokens: 2000,
        cache_read_tokens: 30000,
      },
    })
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('同一 requestId 的多行（流式追加）只保留最后一行', () => {
    const chunk = [
      assistantLine(),
      assistantLine({ uuid: 'uuid-a2' }, { usage: { input_tokens: 4, output_tokens: 250, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000 } }),
    ].join('\n')
    const events = parseTranscriptChunk(`${chunk}\n`, 'fallback')
    expect(events).toHaveLength(1)
    expect(events[0]!.usage.output_tokens).toBe(250)
  })

  it('跳过 user 行、summary 行、synthetic 模型、零用量与坏 JSON', () => {
    const chunk = [
      line({ type: 'user', uuid: 'u1', timestamp: '2026-07-03T08:00:00Z', message: { role: 'user' } }),
      line({ type: 'summary', summary: 'compacted' }),
      assistantLine({ requestId: 'req_syn' }, { model: '<synthetic>' }),
      assistantLine(
        { requestId: 'req_zero' },
        { usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
      ),
      'not-json{{{',
      assistantLine({ requestId: 'req_ok' }),
    ].join('\n')
    const events = parseTranscriptChunk(`${chunk}\n`, 'fallback')
    expect(events).toHaveLength(1)
    expect(events[0]!.message_id).toBe('req_ok')
  })

  it('无 requestId 时回退 message.id，再回退行 uuid', () => {
    const noRequestId = assistantLine({ requestId: undefined })
    const noMessageId = assistantLine({ requestId: undefined, uuid: 'uuid-only' }, { id: undefined })
    const events = parseTranscriptChunk(`${noRequestId}\n${noMessageId}\n`, 'fallback')
    expect(events.map((e) => e.message_id)).toEqual(['msg_01A', 'uuid-only'])
  })

  it('行内缺 sessionId 时使用文件名回退', () => {
    const chunk = assistantLine({ sessionId: undefined })
    const events = parseTranscriptChunk(`${chunk}\n`, 'from-filename')
    expect(events[0]!.session_id).toBe('from-filename')
  })

  it('subagent（isSidechain）行的消耗照常计入', () => {
    const chunk = assistantLine({ isSidechain: true, requestId: 'req_side' })
    const events = parseTranscriptChunk(`${chunk}\n`, 'fallback')
    expect(events).toHaveLength(1)
  })

  it('隐私：产出事件不包含 cwd 等 transcript 字段', () => {
    const events = parseTranscriptChunk(`${assistantLine()}\n`, 'fallback')
    expect(JSON.stringify(events)).not.toContain('/secret/project/path')
  })

  it('缺失的 usage 字段按 0 处理', () => {
    const chunk = assistantLine({}, { usage: { input_tokens: 10, output_tokens: 5 } })
    const events = parseTranscriptChunk(`${chunk}\n`, 'fallback')
    expect(events[0]!.usage.cache_creation_tokens).toBe(0)
    expect(events[0]!.usage.cache_read_tokens).toBe(0)
  })
})
