import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// 表结构契约见 docs/design/event-schema-and-database.md §3。
// 第一期简化（同文档 §4 对应的实现计划）：usage_events 为普通表不分区，
// 因此去重唯一索引无需携带 occurred_at。

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted'])
export const trustLevelEnum = pgEnum('trust_level', ['normal', 'suspect', 'verified'])
export const agentEnum = pgEnum('agent', ['claude_code', 'codex', 'gemini_cli', 'other'])
export const eventTypeEnum = pgEnum('event_type', ['usage', 'usage_summary'])
export const flagStatusEnum = pgEnum('flag_status', ['clean', 'late', 'suspect', 'rejected'])
export const periodTypeEnum = pgEnum('period_type', ['daily', 'weekly', 'monthly', 'all_time'])
export const leaderboardMetricEnum = pgEnum('leaderboard_metric', ['est_cost_usd', 'total_tokens'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 应用层统一转小写后写入，等价于 CITEXT 语义
  email: text('email').notNull().unique(),
  githubId: text('github_id').unique(),
  avatarUrl: text('avatar_url'),
  displayName: text('display_name').notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  status: userStatusEnum('status').notNull().default('active'),
  trustLevel: trustLevelEnum('trust_level').notNull().default('normal'),
  countryCode: char('country_code', { length: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const authCodes = pgTable(
  'auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull().unique(),
    codePrefix: text('code_prefix').notNull(),
    label: text('label'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_auth_codes_user').on(t.userId)]
)

export const models = pgTable('models', {
  id: text('id').primaryKey(),
  vendor: text('vendor').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const modelAliases = pgTable('model_aliases', {
  alias: text('alias').primaryKey(),
  modelId: text('model_id')
    .notNull()
    .references(() => models.id),
})

export const modelPrices = pgTable(
  'model_prices',
  {
    modelId: text('model_id')
      .notNull()
      .references(() => models.id),
    effectiveFrom: date('effective_from').notNull(),
    inputUsdPerMtok: numeric('input_usd_per_mtok', { precision: 10, scale: 4 }).notNull(),
    outputUsdPerMtok: numeric('output_usd_per_mtok', { precision: 10, scale: 4 }).notNull(),
    cacheWriteUsdPerMtok: numeric('cache_write_usd_per_mtok', { precision: 10, scale: 4 }).notNull(),
    cacheReadUsdPerMtok: numeric('cache_read_usd_per_mtok', { precision: 10, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.modelId, t.effectiveFrom] })]
)

export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    authCodeId: uuid('auth_code_id')
      .notNull()
      .references(() => authCodes.id),
    agent: agentEnum('agent').notNull(),
    agentVersion: text('agent_version'),
    pluginVersion: text('plugin_version'),
    eventType: eventTypeEnum('event_type').notNull().default('usage'),
    sessionId: text('session_id').notNull(),
    messageId: text('message_id'),
    modelRaw: text('model_raw').notNull(),
    modelId: text('model_id').references(() => models.id),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    turnDurationMs: integer('turn_duration_ms'),
    geoCountry: char('geo_country', { length: 2 }),
    geoCity: text('geo_city'),
    ipHash: text('ip_hash'),
    flagStatus: flagStatusEnum('flag_status').notNull().default('clean'),
    flagReason: text('flag_reason'),
  },
  (t) => [
    uniqueIndex('uq_events_message_dedup')
      .on(t.userId, t.agent, t.sessionId, t.messageId)
      .where(sql`message_id is not null`),
    uniqueIndex('uq_events_event_id').on(t.userId, t.eventId),
    index('idx_events_user_time').on(t.userId, t.occurredAt.desc()),
    index('idx_events_needs_norm').on(t.receivedAt).where(sql`model_id is null`),
  ]
)

export const usageDailyRollups = pgTable(
  'usage_daily_rollups',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    day: date('day').notNull(),
    agent: agentEnum('agent').notNull(),
    // 未归一化事件计入 'unknown'，归一化后由重算修正
    modelId: text('model_id').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).generatedAlwaysAs(
      sql`input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens`
    ),
    // scale 6：成本按事件累加，粒度必须低于最小可能的单事件成本，展示层再舍入
    estCostUsd: numeric('est_cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    eventsCount: integer('events_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day, t.agent, t.modelId] }),
    index('idx_rollups_day_cost').on(t.day, t.estCostUsd.desc()),
  ]
)

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    board: text('board').notNull(),
    periodType: periodTypeEnum('period_type').notNull(),
    periodStart: date('period_start').notNull(),
    metric: leaderboardMetricEnum('metric').notNull(),
    rank: integer('rank').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    metricValue: numeric('metric_value', { precision: 18, scale: 6 }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.board, t.periodType, t.periodStart, t.metric, t.rank] })]
)

export const ingestBatches = pgTable('ingest_batches', {
  // 直接使用客户端 batch_id
  id: uuid('id').primaryKey(),
  authCodeId: uuid('auth_code_id')
    .notNull()
    .references(() => authCodes.id),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  eventsTotal: integer('events_total').notNull(),
  eventsAccepted: integer('events_accepted').notNull(),
  eventsDuplicate: integer('events_duplicate').notNull(),
  eventsRejected: integer('events_rejected').notNull(),
  geoCountry: char('geo_country', { length: 2 }),
  ipHash: text('ip_hash'),
  pluginVersion: text('plugin_version'),
})
