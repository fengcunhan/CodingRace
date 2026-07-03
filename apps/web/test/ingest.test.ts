import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { seedCatalog } from '../src/db/seed'
import type { Db } from '../src/db/types'
import { authenticate, hashAuthCode } from '../src/ingest/auth'
import { processIngestBatch, type ProcessInput } from '../src/ingest/process'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
const NOW = new Date('2026-07-03T12:00:00Z')
const AUTH_CODE = 'cr_live_test1234567890abcdef'

let db: Db
let userId: string
let authCodeId: string

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema })
  await migrate(pglite, { migrationsFolder: MIGRATIONS })
  db = pglite as unknown as Db
  await seedCatalog(db)

  const [user] = await db
    .insert(schema.users)
    .values({ email: 'tester@example.com', displayName: 'tester' })
    .returning()
  if (!user) throw new Error('failed to create test user')
  userId = user.id

  const [code] = await db
    .insert(schema.authCodes)
    .values({ userId, codeHash: hashAuthCode(AUTH_CODE), codePrefix: 'cr_live_test' })
    .returning()
  if (!code) throw new Error('failed to create test auth code')
  authCodeId = code.id
})

beforeEach(async () => {
  await db.delete(schema.usageEvents)
  await db.delete(schema.usageDailyRollups)
  await db.delete(schema.ingestBatches)
})

function usageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    event_type: 'usage',
    agent: 'claude_code',
    session_id: 'session-1',
    message_id: `msg-${randomUUID()}`,
    model_raw: 'claude-sonnet-5',
    usage: {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_tokens: 3000,
      cache_read_tokens: 100000,
    },
    occurred_at: '2026-07-03T11:00:00Z',
    ...overrides,
  }
}

function envelope(events: unknown[], batchId: string = randomUUID()): Record<string, unknown> {
  return {
    schema_version: 1,
    batch_id: batchId,
    client: {
      plugin_name: 'codingrace-plugin',
      plugin_version: '0.1.0',
      agent: 'claude_code',
      agent_version: '2.1.0',
    },
    events,
  }
}

function processInput(body: unknown, now: Date = NOW): ProcessInput {
  return {
    body,
    auth: { authCodeId, userId },
    now,
    geoCountry: 'CN',
    geoCity: 'Shanghai',
    ipHash: 'test-ip-hash',
  }
}

async function run(body: unknown, now: Date = NOW) {
  const outcome = await processIngestBatch(db, processInput(body, now))
  if (outcome.kind !== 'ok') throw new Error(`unexpected outcome: ${outcome.kind}`)
  return outcome.response
}

describe('processIngestBatch — 主流程', () => {
  it('接受批次：事件落库、模型归一化、按促销价折算成本并聚合', async () => {
    const response = await run(envelope([usageEvent(), usageEvent()]))
    expect(response.results.map((r) => r.status)).toEqual(['accepted', 'accepted'])

    const events = await db.select().from(schema.usageEvents)
    expect(events).toHaveLength(2)
    expect(events[0]!.modelId).toBe('claude-sonnet-5')
    expect(events[0]!.flagStatus).toBe('clean')
    expect(events[0]!.geoCountry).toBe('CN')

    const rollups = await db.select().from(schema.usageDailyRollups)
    expect(rollups).toHaveLength(1)
    const rollup = rollups[0]!
    expect(rollup.day).toBe('2026-07-03')
    expect(rollup.modelId).toBe('claude-sonnet-5')
    expect(rollup.inputTokens).toBe(2000)
    expect(rollup.cacheReadTokens).toBe(200000)
    expect(rollup.totalTokens).toBe(212000)
    // 单事件成本 (1000*2 + 2000*10 + 3000*2.5 + 100000*0.2)/1e6 = 0.0495（Sonnet 5 促销价）
    expect(rollup.estCostUsd).toBe('0.099000')
    expect(rollup.eventsCount).toBe(2)

    const batches = await db.select().from(schema.ingestBatches)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.eventsAccepted).toBe(2)
  })

  it('幂等：同一批次重发全部返回 duplicate，聚合值不变（S4）', async () => {
    const env = envelope([usageEvent(), usageEvent()])
    await run(env)
    for (let i = 0; i < 3; i++) {
      const replay = await run(env)
      expect(replay.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate'])
    }

    const rollups = await db.select().from(schema.usageDailyRollups)
    expect(rollups[0]!.estCostUsd).toBe('0.099000')
    expect(rollups[0]!.eventsCount).toBe(2)
    expect(await db.select().from(schema.usageEvents)).toHaveLength(2)
  })

  it('同一消息换 event_id 重报仍判 duplicate（消息级去重键）', async () => {
    const messageId = 'msg-shared'
    await run(envelope([usageEvent({ message_id: messageId })]))
    const response = await run(envelope([usageEvent({ message_id: messageId })]))
    expect(response.results[0]!.status).toBe('duplicate')
  })

  it('occurred_at 超前超过时钟容差拒收', async () => {
    const response = await run(envelope([usageEvent({ occurred_at: '2026-07-03T12:20:00Z' })]))
    expect(response.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'occurred_at_in_future',
    })
    expect(await db.select().from(schema.usageEvents)).toHaveLength(0)
  })

  it('迟到超过 72h 标记 late 但正常聚合到历史日期', async () => {
    const response = await run(envelope([usageEvent({ occurred_at: '2026-06-25T11:00:00Z' })]))
    expect(response.results[0]!.status).toBe('accepted')

    const events = await db.select().from(schema.usageEvents)
    expect(events[0]!.flagStatus).toBe('late')

    const rollups = await db.select().from(schema.usageDailyRollups)
    expect(rollups[0]!.day).toBe('2026-06-25')
    expect(rollups[0]!.eventsCount).toBe(1)
  })

  it('usage_summary 第一期拒收', async () => {
    const summary = usageEvent({
      event_type: 'usage_summary',
      message_id: null,
      period_start: '2026-07-03T10:00:00Z',
    })
    const response = await run(envelope([summary]))
    expect(response.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'unsupported_in_phase1',
    })
  })

  it('部分成功：坏事件拒收不影响同批其他事件', async () => {
    const malformed = usageEvent({ usage: undefined })
    const response = await run(envelope([usageEvent(), malformed, usageEvent()]))
    expect(response.results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'accepted'])
    expect(response.results[1]!.reason).toBe('invalid_event')
    expect(await db.select().from(schema.usageEvents)).toHaveLength(2)
  })

  it('token 超单事件上限按 implausible_value 拒收', async () => {
    const oversized = usageEvent({
      usage: {
        input_tokens: 50_000_001,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      },
    })
    const response = await run(envelope([oversized]))
    expect(response.results[0]).toMatchObject({ status: 'rejected', reason: 'implausible_value' })
  })

  it('输出速率超物理上限：落库标记 suspect，不进聚合', async () => {
    const implausible = usageEvent({
      turn_duration_ms: 1000,
      usage: {
        input_tokens: 0,
        output_tokens: 100000,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      },
    })
    const response = await run(envelope([implausible]))
    expect(response.results[0]!.status).toBe('accepted')

    const events = await db.select().from(schema.usageEvents)
    expect(events[0]!.flagStatus).toBe('suspect')
    expect(events[0]!.flagReason).toBe('output_rate_exceeds_ceiling')
    expect(await db.select().from(schema.usageDailyRollups)).toHaveLength(0)
  })

  it('未知模型：接受入库，聚合计入 unknown，成本为 0', async () => {
    const response = await run(envelope([usageEvent({ model_raw: 'gpt-5-codex' })]))
    expect(response.results[0]!.status).toBe('accepted')

    const events = await db.select().from(schema.usageEvents)
    expect(events[0]!.modelId).toBeNull()
    expect(events[0]!.modelRaw).toBe('gpt-5-codex')

    const rollups = await db.select().from(schema.usageDailyRollups)
    expect(rollups[0]!.modelId).toBe('unknown')
    expect(rollups[0]!.estCostUsd).toBe('0.000000')
  })

  it('Bedrock 形态的模型 ID 归一化后按对应定价折算', async () => {
    const event = usageEvent({
      model_raw: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_tokens: 0, cache_read_tokens: 0 },
    })
    await run(envelope([event]))

    const rollups = await db.select().from(schema.usageDailyRollups)
    expect(rollups[0]!.modelId).toBe('claude-sonnet-4-5')
    // (1000*3 + 2000*15)/1e6 = 0.033
    expect(rollups[0]!.estCostUsd).toBe('0.033000')
  })

  it('定价生效日切换：9 月起 Sonnet 5 按标准价折算', async () => {
    const now = new Date('2026-09-02T12:00:00Z')
    const event = usageEvent({
      occurred_at: '2026-09-02T08:00:00Z',
      usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_tokens: 0, cache_read_tokens: 0 },
    })
    await run(envelope([event]), now)

    const rollups = await db.select().from(schema.usageDailyRollups)
    // (1000*3 + 2000*15)/1e6 = 0.033（标准价），促销价应为 0.022
    expect(rollups[0]!.estCostUsd).toBe('0.033000')
  })

  it('信封不合法（schema_version 不匹配）整批拒绝', async () => {
    const bad = { ...envelope([usageEvent()]), schema_version: 2 }
    const outcome = await processIngestBatch(db, processInput(bad))
    expect(outcome.kind).toBe('invalid_envelope')
  })

  it('超过 100 条事件整批拒绝', async () => {
    const events = Array.from({ length: 101 }, () => usageEvent())
    const outcome = await processIngestBatch(db, processInput(envelope(events)))
    expect(outcome.kind).toBe('invalid_envelope')
  })
})

describe('authenticate — 认证', () => {
  it('有效 code 返回 user 与 code id', async () => {
    const result = await authenticate(db, AUTH_CODE)
    expect(result).toEqual({ ok: true, authCodeId, userId })
  })

  it('未知 code 返回 401', async () => {
    const result = await authenticate(db, 'cr_live_doesnotexist')
    expect(result).toMatchObject({ ok: false, status: 401, error: 'invalid_auth_code' })
  })

  it('已吊销 code 返回 403', async () => {
    const revoked = 'cr_live_revokedcode000000'
    await db.insert(schema.authCodes).values({
      userId,
      codeHash: hashAuthCode(revoked),
      codePrefix: 'cr_live_revo',
      revokedAt: NOW,
    })
    const result = await authenticate(db, revoked)
    expect(result).toMatchObject({ ok: false, status: 403, error: 'auth_code_revoked' })
  })

  it('被封禁用户的 code 返回 403', async () => {
    const [suspended] = await db
      .insert(schema.users)
      .values({ email: 'suspended@example.com', displayName: 'sus', status: 'suspended' })
      .returning()
    const code = 'cr_live_suspendeduser0000'
    await db.insert(schema.authCodes).values({
      userId: suspended!.id,
      codeHash: hashAuthCode(code),
      codePrefix: 'cr_live_susp',
    })
    const result = await authenticate(db, code)
    expect(result).toMatchObject({ ok: false, status: 403, error: 'account_disabled' })
  })
})
