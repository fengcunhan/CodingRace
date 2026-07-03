import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { UsageEvent } from '@codingrace/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deadLetterDir, ensureDirs } from '../src/paths'
import { enqueue, listQueueFiles, readBatch } from '../src/queue'
import { sendQueued } from '../src/sender'

const NOW = new Date('2026-07-03T12:00:00Z')
const CONFIG = { authCode: 'cr_live_test', endpoint: 'https://example.com/' }

beforeEach(() => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'codingrace-test-'))
  process.env.CODINGRACE_DIR = tmp
  ensureDirs()
})

afterEach(() => {
  delete process.env.CODINGRACE_DIR
})

function event(): UsageEvent {
  return {
    event_id: randomUUID(),
    event_type: 'usage',
    agent: 'claude_code',
    session_id: 'sess-1',
    message_id: `msg-${randomUUID()}`,
    model_raw: 'claude-sonnet-5',
    usage: { input_tokens: 1, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0 },
    occurred_at: '2026-07-03T11:00:00Z',
  }
}

function okFetch(calls: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    return new Response(JSON.stringify({ batch_id: randomUUID(), results: [] }), { status: 200 })
  }) as typeof fetch
}

describe('enqueue — 批次切分', () => {
  it('250 条事件切成 3 个批次文件，每批不超过 100', () => {
    const count = enqueue(Array.from({ length: 250 }, event), NOW)
    expect(count).toBe(3)
    const sizes = listQueueFiles().map((f) => readBatch(f)!.events.length)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(250)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100)
  })

  it('空事件列表不产生文件', () => {
    expect(enqueue([], NOW)).toBe(0)
    expect(listQueueFiles()).toHaveLength(0)
  })
})

describe('sendQueued — 上报与重试语义', () => {
  it('成功：发送信封携带 Bearer 与协议字段，文件删除', async () => {
    enqueue([event(), event()], NOW)
    const calls: Array<{ url: string; init: RequestInit }> = []

    const stats = await sendQueued(CONFIG, okFetch(calls))
    expect(stats).toEqual({ sent: 1, kept: 0, dead: 0 })
    expect(listQueueFiles()).toHaveLength(0)

    expect(calls[0]!.url).toBe('https://example.com/api/v1/ingest')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer cr_live_test')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body.schema_version).toBe(1)
    expect((body.client as Record<string, unknown>).plugin_name).toBe('codingrace-plugin')
    expect(body.events).toHaveLength(2)
  })

  it('batch_id 在重试间保持稳定', async () => {
    enqueue([event()], NOW)
    const failCalls: Array<{ url: string; init: RequestInit }> = []
    const fail: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      failCalls.push({ url: String(url), init: init! })
      return new Response('oops', { status: 500 })
    }) as typeof fetch

    await sendQueued(CONFIG, fail)
    const okCalls: Array<{ url: string; init: RequestInit }> = []
    await sendQueued(CONFIG, okFetch(okCalls))

    const firstId = (JSON.parse(String(failCalls[0]!.init.body)) as Record<string, unknown>).batch_id
    const secondId = (JSON.parse(String(okCalls[0]!.init.body)) as Record<string, unknown>).batch_id
    expect(secondId).toBe(firstId)
  })

  it('5xx / 429：保留文件并停止本轮后续批次', async () => {
    enqueue([event()], NOW)
    enqueue([event()], NOW)
    let callCount = 0
    const fail: typeof fetch = (async () => {
      callCount += 1
      return new Response('busy', { status: 429 })
    }) as typeof fetch

    const stats = await sendQueued(CONFIG, fail)
    expect(stats).toEqual({ sent: 0, kept: 1, dead: 0 })
    expect(callCount).toBe(1)
    expect(listQueueFiles()).toHaveLength(2)
  })

  it('403（吊销）：移入死信目录，不再重试', async () => {
    enqueue([event()], NOW)
    const reject: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: 'auth_code_revoked' }), { status: 403 })) as typeof fetch

    const stats = await sendQueued(CONFIG, reject)
    expect(stats).toEqual({ sent: 0, kept: 0, dead: 1 })
    expect(listQueueFiles()).toHaveLength(0)
    expect(readdirSync(deadLetterDir())).toHaveLength(1)
  })

  it('网络异常：保留文件待下次触发', async () => {
    enqueue([event()], NOW)
    const boom: typeof fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const stats = await sendQueued(CONFIG, boom)
    expect(stats).toEqual({ sent: 0, kept: 1, dead: 0 })
    expect(listQueueFiles()).toHaveLength(1)
    expect(existsSync(listQueueFiles()[0]!)).toBe(true)
  })
})
