import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { usageDailyRollups, users } from '../db/schema'
import type { Db } from '../db/types'

export type LeaderboardPeriod = 'weekly' | 'all_time'
export type LeaderboardMetric = 'cost' | 'tokens'

export interface LeaderboardQuery {
  period: LeaderboardPeriod
  metric: LeaderboardMetric
  model?: string | null
  agent?: string | null
  now: Date
  limit?: number
}

export interface LeaderboardRow {
  rank: number
  userId: string
  displayName: string
  avatarUrl: string | null
  estCostUsd: number
  totalTokens: number
}

// 周榜口径：滚动最近 7 个 UTC 自然日（含今天）
export function weeklySince(now: Date): string {
  const since = new Date(now.getTime() - 6 * 24 * 3600 * 1000)
  return since.toISOString().slice(0, 10)
}

export async function queryLeaderboard(db: Db, query: LeaderboardQuery): Promise<LeaderboardRow[]> {
  const costSum = sql<string>`sum(${usageDailyRollups.estCostUsd})`
  const tokenSum = sql<string>`sum(${usageDailyRollups.totalTokens})`

  const conditions = [
    eq(users.isPublic, true),
    eq(users.status, 'active'),
    ne(users.trustLevel, 'suspect'),
    ...(query.period === 'weekly' ? [gte(usageDailyRollups.day, weeklySince(query.now))] : []),
    ...(query.model ? [eq(usageDailyRollups.modelId, query.model)] : []),
    ...(query.agent ? [eq(usageDailyRollups.agent, query.agent as never)] : []),
  ]

  const rows = await db
    .select({
      userId: usageDailyRollups.userId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      cost: costSum,
      tokens: tokenSum,
    })
    .from(usageDailyRollups)
    .innerJoin(users, eq(users.id, usageDailyRollups.userId))
    .where(and(...conditions))
    .groupBy(usageDailyRollups.userId, users.displayName, users.avatarUrl)
    .orderBy(desc(query.metric === 'cost' ? costSum : tokenSum))
    .limit(query.limit ?? 50)

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    estCostUsd: Number(row.cost),
    totalTokens: Number(row.tokens),
  }))
}

// 榜单模型筛选项：只列出实际出现过消耗的模型
export async function listActiveModels(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ modelId: usageDailyRollups.modelId })
    .from(usageDailyRollups)
  return rows
    .map((r) => r.modelId)
    .filter((m) => m !== 'unknown')
    .sort()
}
