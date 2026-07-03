import { randomUUID } from 'node:crypto'
import type { UsageEvent } from '@codingrace/schema'

// 隐私红线：本解析器只读取 usage 计数、model、时间戳与去重标识，
// 对话内容 / cwd / 文件路径等字段一律不触碰（协议禁止字段清单见设计文档 §2.3）

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractUsage(record: unknown, fallbackSessionId: string): UsageEvent | null {
  const line = asRecord(record)
  if (!line || line.type !== 'assistant') return null

  const message = asRecord(line.message)
  if (!message) return null
  const usage = asRecord(message.usage)
  if (!usage) return null

  const model = asString(message.model)
  // Claude Code 本地合成的错误消息使用 '<synthetic>'，不是真实消耗
  if (!model || model === '<synthetic>') return null

  const counts = {
    input_tokens: asCount(usage.input_tokens),
    output_tokens: asCount(usage.output_tokens),
    cache_creation_tokens: asCount(usage.cache_creation_input_tokens),
    cache_read_tokens: asCount(usage.cache_read_input_tokens),
  }
  const total =
    counts.input_tokens +
    counts.output_tokens +
    counts.cache_creation_tokens +
    counts.cache_read_tokens
  if (total === 0) return null

  // 去重标识优先级：requestId（同一 API 请求可能产生多行）> message.id > 行 uuid
  const messageId = asString(line.requestId) ?? asString(message.id) ?? asString(line.uuid)
  const timestamp = asString(line.timestamp)
  if (!messageId || !timestamp) return null

  return {
    event_id: randomUUID(),
    event_type: 'usage',
    agent: 'claude_code',
    session_id: asString(line.sessionId) ?? fallbackSessionId,
    message_id: messageId,
    model_raw: model,
    usage: counts,
    occurred_at: timestamp,
  }
}

// 解析一段完整行组成的 transcript 片段。同一 message_id 的多行（流式追加）
// 只保留最后一行的 usage（累计值），坏行 / 非 assistant 行静默跳过。
export function parseTranscriptChunk(chunk: string, fallbackSessionId: string): UsageEvent[] {
  const byMessage = new Map<string, UsageEvent>()

  for (const line of chunk.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }

    const event = extractUsage(record, fallbackSessionId)
    if (event) {
      byMessage.set(event.message_id, event)
    }
  }

  return [...byMessage.values()]
}
