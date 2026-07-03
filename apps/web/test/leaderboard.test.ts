import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import type { Db } from '../src/db/types'
import { listActiveModels, queryLeaderboard, weeklySince } from '../src/leaderboard/query'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
const NOW = new Date('2026-07-03T12:00:00Z')

let db: Db

async function createUser(
  name: string,
  opts: { isPublic?: boolean; trustLevel?: 'normal' | 'suspect' } = {}
): Promise<string> {
  const rows = await db
    .insert(schema.users)
    .values({
      email: `${name}@example.com`,
      displayName: name,
      isPublic: opts.isPublic ?? true,
      trustLevel: opts.trustLevel ?? 'normal',
    })
    .returning({ id: schema.users.id })
  return rows[0]!.id
}

async function addRollup(
  userId: string,
  day: string,
  costUsd: string,
  tokens: number,
  modelId = 'claude-sonnet-5'
): Promise<void> {
  await db.insert(schema.usageDailyRollups).values({
    userId,
    day,
    agent: 'claude_code',
    modelId,
    inputTokens: tokens,
    estCostUsd: costUsd,
    eventsCount: 1,
  })
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema })
  await migrate(pglite, { migrationsFolder: MIGRATIONS })
  db = pglite as unknown as Db

  const alice = await createUser('alice')
  const bob = await createUser('bob')
  const carol = await createUser('carol', { isPublic: false })
  const mallory = await createUser('mallory', { trustLevel: 'suspect' })

  await addRollup(alice, '2026-07-01', '10.500000', 1000)
  await addRollup(alice, '2026-06-20', '5.000000', 99000) // 周榜窗口外
  await addRollup(bob, '2026-07-02', '8.000000', 50000)
  await addRollup(bob, '2026-07-02', '1.000000', 500, 'claude-opus-4-8')
  await addRollup(carol, '2026-07-02', '100.000000', 999999) // 未公开
  await addRollup(mallory, '2026-07-02', '999.000000', 9999999) // suspect
})

describe('queryLeaderboard', () => {
  it('周榜按成本排序，只含公开且非 suspect 用户', async () => {
    const rows = await queryLeaderboard(db, { period: 'weekly', metric: 'cost', now: NOW })
    expect(rows.map((r) => [r.displayName, r.estCostUsd])).toEqual([
      ['alice', 10.5],
      ['bob', 9],
    ])
    expect(rows[0]!.rank).toBe(1)
  })

  it('总榜包含窗口外的历史数据', async () => {
    const rows = await queryLeaderboard(db, { period: 'all_time', metric: 'cost', now: NOW })
    expect(rows[0]).toMatchObject({ displayName: 'alice', estCostUsd: 15.5 })
  })

  it('按 token 排序时顺序不同', async () => {
    const rows = await queryLeaderboard(db, { period: 'weekly', metric: 'tokens', now: NOW })
    expect(rows.map((r) => r.displayName)).toEqual(['bob', 'alice'])
    expect(rows[0]!.totalTokens).toBe(50500)
  })

  it('模型筛选只统计对应模型', async () => {
    const rows = await queryLeaderboard(db, {
      period: 'weekly',
      metric: 'cost',
      model: 'claude-opus-4-8',
      now: NOW,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ displayName: 'bob', estCostUsd: 1 })
  })

  it('weeklySince 为含当天的滚动 7 日窗口', () => {
    expect(weeklySince(NOW)).toBe('2026-06-27')
  })
})

describe('listActiveModels', () => {
  it('返回出现过消耗的模型（不含 unknown）', async () => {
    const models = await listActiveModels(db)
    expect(models).toEqual(['claude-opus-4-8', 'claude-sonnet-5'])
  })
})
