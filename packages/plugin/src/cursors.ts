import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cursorsDir } from './paths'

export interface Cursor {
  transcriptPath: string
  offset: number
  updatedAt: string
}

function cursorFile(transcriptPath: string): string {
  const key = createHash('sha256').update(transcriptPath).digest('hex').slice(0, 16)
  return path.join(cursorsDir(), `${key}.json`)
}

export function readCursor(transcriptPath: string): Cursor | null {
  try {
    const raw = fs.readFileSync(cursorFile(transcriptPath), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.transcriptPath === 'string' && typeof parsed.offset === 'number') {
      return {
        transcriptPath: parsed.transcriptPath,
        offset: parsed.offset,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      }
    }
    return null
  } catch {
    return null
  }
}

export function saveCursor(cursor: Cursor): void {
  fs.writeFileSync(cursorFile(cursor.transcriptPath), `${JSON.stringify(cursor)}\n`)
}

// hook 触发时登记 transcript，worker 后续统一扫描（含补报崩溃会话）
export function registerTranscript(transcriptPath: string, now: Date): void {
  if (!readCursor(transcriptPath)) {
    saveCursor({ transcriptPath, offset: 0, updatedAt: now.toISOString() })
  }
}

export function listCursors(): Cursor[] {
  let files: string[]
  try {
    files = fs.readdirSync(cursorsDir())
  } catch {
    return []
  }

  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(cursorsDir(), f), 'utf8')) as Record<
          string,
          unknown
        >
        if (typeof parsed.transcriptPath === 'string' && typeof parsed.offset === 'number') {
          return {
            transcriptPath: parsed.transcriptPath,
            offset: parsed.offset,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
          }
        }
        return null
      } catch {
        return null
      }
    })
    .filter((c): c is Cursor => c !== null)
}

export interface NewChunk {
  chunk: string
  nextOffset: number
}

// 从游标偏移量读取新增的完整行；文件被截断（轮转）时从头重读，
// 重复上报由服务端幂等吸收。末尾不完整的行留待下次。
export function readNewChunk(cursor: Cursor): NewChunk | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(cursor.transcriptPath)
  } catch {
    return null
  }

  const start = stat.size < cursor.offset ? 0 : cursor.offset
  if (stat.size === start) return null

  const fd = fs.openSync(cursor.transcriptPath, 'r')
  try {
    const buffer = Buffer.alloc(stat.size - start)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8', 0, bytesRead)

    const lastNewline = text.lastIndexOf('\n')
    if (lastNewline === -1) return null

    const chunk = text.slice(0, lastNewline + 1)
    return { chunk, nextOffset: start + Buffer.byteLength(chunk, 'utf8') }
  } finally {
    fs.closeSync(fd)
  }
}
