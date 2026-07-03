import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_EVENTS_PER_BATCH, type UsageEvent } from '@codingrace/schema'
import { queueDir } from './paths'

export interface QueueBatch {
  batchId: string
  createdAt: string
  events: UsageEvent[]
}

// 每个批次一个文件；batch_id 随文件持久化，重试时保持不变（服务端批次审计幂等）
export function enqueue(events: UsageEvent[], now: Date): number {
  if (events.length === 0) return 0

  const chunks: UsageEvent[][] = []
  for (let i = 0; i < events.length; i += MAX_EVENTS_PER_BATCH) {
    chunks.push(events.slice(i, i + MAX_EVENTS_PER_BATCH))
  }

  for (const chunk of chunks) {
    const batch: QueueBatch = {
      batchId: randomUUID(),
      createdAt: now.toISOString(),
      events: chunk,
    }
    const filename = `${now.getTime()}-${batch.batchId}.json`
    fs.writeFileSync(path.join(queueDir(), filename), `${JSON.stringify(batch)}\n`)
  }
  return chunks.length
}

export function listQueueFiles(): string[] {
  try {
    return fs
      .readdirSync(queueDir())
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => path.join(queueDir(), f))
  } catch {
    return []
  }
}

export function readBatch(filePath: string): QueueBatch | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    if (typeof parsed.batchId === 'string' && Array.isArray(parsed.events)) {
      return {
        batchId: parsed.batchId,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
        events: parsed.events as UsageEvent[],
      }
    }
    return null
  } catch {
    return null
  }
}
