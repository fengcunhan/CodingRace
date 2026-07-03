import { mkdtempSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCursors, readCursor, readNewChunk, registerTranscript, saveCursor } from '../src/cursors'
import { ensureDirs } from '../src/paths'

let tmp: string
let transcript: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'codingrace-test-'))
  process.env.CODINGRACE_DIR = path.join(tmp, 'data')
  ensureDirs()
  transcript = path.join(tmp, 'sess-abc.jsonl')
})

afterEach(() => {
  delete process.env.CODINGRACE_DIR
})

describe('cursors — 增量读取', () => {
  it('registerTranscript 幂等：不覆盖已有偏移量', () => {
    registerTranscript(transcript, new Date('2026-07-03T00:00:00Z'))
    saveCursor({ transcriptPath: transcript, offset: 42, updatedAt: 'x' })
    registerTranscript(transcript, new Date('2026-07-03T01:00:00Z'))
    expect(readCursor(transcript)?.offset).toBe(42)
  })

  it('只消费完整行，末尾未换行的部分留待下次', () => {
    writeFileSync(transcript, 'line-1\nline-2\npartial')
    registerTranscript(transcript, new Date())

    const first = readNewChunk(readCursor(transcript)!)
    expect(first?.chunk).toBe('line-1\nline-2\n')

    saveCursor({ transcriptPath: transcript, offset: first!.nextOffset, updatedAt: 'x' })
    appendFileSync(transcript, '-done\nline-3\n')

    const second = readNewChunk(readCursor(transcript)!)
    expect(second?.chunk).toBe('partial-done\nline-3\n')
  })

  it('无新增内容时返回 null', () => {
    writeFileSync(transcript, 'line-1\n')
    registerTranscript(transcript, new Date())
    const first = readNewChunk(readCursor(transcript)!)
    saveCursor({ transcriptPath: transcript, offset: first!.nextOffset, updatedAt: 'x' })
    expect(readNewChunk(readCursor(transcript)!)).toBeNull()
  })

  it('文件被截断（轮转）时从头重读', () => {
    writeFileSync(transcript, 'a-very-long-first-generation-content\n')
    registerTranscript(transcript, new Date())
    const first = readNewChunk(readCursor(transcript)!)
    saveCursor({ transcriptPath: transcript, offset: first!.nextOffset, updatedAt: 'x' })

    writeFileSync(transcript, 'short\n')
    expect(readNewChunk(readCursor(transcript)!)?.chunk).toBe('short\n')
  })

  it('transcript 文件不存在时返回 null 而不抛错', () => {
    expect(
      readNewChunk({ transcriptPath: path.join(tmp, 'missing.jsonl'), offset: 0, updatedAt: '' })
    ).toBeNull()
  })

  it('listCursors 返回全部已登记会话', () => {
    registerTranscript(path.join(tmp, 'a.jsonl'), new Date())
    registerTranscript(path.join(tmp, 'b.jsonl'), new Date())
    expect(listCursors()).toHaveLength(2)
  })
})
