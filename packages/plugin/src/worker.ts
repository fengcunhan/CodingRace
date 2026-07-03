import fs from 'node:fs'
import path from 'node:path'
import { readConfig } from './config'
import { listCursors, readNewChunk, saveCursor } from './cursors'
import { appendError } from './log'
import { parseTranscriptChunk } from './parser'
import { ensureDirs, lockPath } from './paths'
import { enqueue } from './queue'
import { sendQueued } from './sender'

const LOCK_STALE_MS = 5 * 60_000

function acquireLock(now: Date): boolean {
  try {
    fs.writeFileSync(lockPath(), String(process.pid), { flag: 'wx' })
    return true
  } catch {
    try {
      const stat = fs.statSync(lockPath())
      if (now.getTime() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath(), { force: true })
        fs.writeFileSync(lockPath(), String(process.pid), { flag: 'wx' })
        return true
      }
    } catch {
      // 竞争中被他人处理，放弃本轮
    }
    return false
  }
}

function releaseLock(): void {
  try {
    // 只释放自己持有的锁，避免误删并发 worker 抢占后的新锁
    if (fs.readFileSync(lockPath(), 'utf8') === String(process.pid)) {
      fs.rmSync(lockPath(), { force: true })
    }
  } catch {
    // 锁已不存在
  }
}

function sessionIdFromPath(transcriptPath: string): string {
  return path.basename(transcriptPath, '.jsonl')
}

// 扫描所有已登记的 transcript：增量解析 → 入队。
// 每次都全量扫描游标目录，天然补报上次崩溃 / Ctrl-C 遗漏的会话。
export function collectNewEvents(now: Date): number {
  const collected = listCursors().reduce((total, cursor) => {
    const chunk = readNewChunk(cursor)
    if (!chunk) return total

    const events = parseTranscriptChunk(chunk.chunk, sessionIdFromPath(cursor.transcriptPath))
    enqueue(events, now)
    saveCursor({ ...cursor, offset: chunk.nextOffset, updatedAt: now.toISOString() })
    return total + events.length
  }, 0)
  return collected
}

export async function runWorker(): Promise<void> {
  ensureDirs()
  const now = new Date()
  if (!acquireLock(now)) return

  try {
    const config = readConfig()
    if (!config) {
      appendError('worker', 'no config; run `codingrace install` first')
      return
    }
    collectNewEvents(now)
    await sendQueued(config)
  } catch (error) {
    appendError('worker', error)
  } finally {
    releaseLock()
  }
}
