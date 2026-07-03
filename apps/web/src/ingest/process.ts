import {
  ingestEnvelopeBaseSchema,
  reportEventSchema,
  type ClientInfo,
  type EventResult,
  type IngestResponse,
  type UsageEvent,
} from '@codingrace/schema'
import { sql } from 'drizzle-orm'
import { ingestBatches, usageDailyRollups, usageEvents } from '../db/schema'
import type { Db } from '../db/types'
import { computeCostUsd, loadCatalog, normalizeModelId, priceFor, type Catalog } from './catalog'
import { INGEST_LIMITS, UNKNOWN_MODEL_KEY } from './config'

export interface ProcessInput {
  body: unknown
  auth: { authCodeId: string; userId: string }
  now: Date
  geoCountry: string | null
  geoCity: string | null
  ipHash: string | null
}

export type ProcessOutcome =
  | { kind: 'invalid_envelope' }
  | { kind: 'ok'; response: IngestResponse }

type FlagStatus = 'clean' | 'late' | 'suspect'

interface Candidate {
  index: number
  event: UsageEvent
  day: string
  flagStatus: FlagStatus
  flagReason: string | null
  modelId: string | null
  costUsd: number
}

interface Classified {
  eventId: string
  rejection?: EventResult
  candidate?: Candidate
}

function extractEventId(raw: unknown, index: number): string {
  if (raw !== null && typeof raw === 'object') {
    const value = (raw as Record<string, unknown>).event_id
    if (typeof value === 'string' && value.length > 0) return value
  }
  return `unknown:${index}`
}

function classify(raw: unknown, index: number, now: Date, catalog: Catalog): Classified {
  const eventId = extractEventId(raw, index)
  const rejected = (reason: string): Classified => ({
    eventId,
    rejection: { event_id: eventId, status: 'rejected', reason },
  })

  const parsed = reportEventSchema.safeParse(raw)
  if (!parsed.success) {
    const tokenTooBig = parsed.error.issues.some(
      (issue) => issue.code === 'too_big' && issue.path[0] === 'usage'
    )
    return rejected(tokenTooBig ? 'implausible_value' : 'invalid_event')
  }

  const event = parsed.data
  if (event.event_type === 'usage_summary') {
    return rejected('unsupported_in_phase1')
  }

  const occurredMs = Date.parse(event.occurred_at)
  if (occurredMs > now.getTime() + INGEST_LIMITS.maxFutureSkewMs) {
    return rejected('occurred_at_in_future')
  }

  let flagStatus: FlagStatus = 'clean'
  let flagReason: string | null = null
  if (now.getTime() - occurredMs > INGEST_LIMITS.lateThresholdMs) {
    flagStatus = 'late'
  }
  if (event.turn_duration_ms !== undefined) {
    const outputPerSecond = event.usage.output_tokens / (event.turn_duration_ms / 1000)
    if (outputPerSecond > INGEST_LIMITS.maxOutputTokensPerSecond) {
      flagStatus = 'suspect'
      flagReason = 'output_rate_exceeds_ceiling'
    }
  }

  const day = new Date(occurredMs).toISOString().slice(0, 10)
  const modelId = normalizeModelId(catalog, event.model_raw)
  const price = modelId ? priceFor(catalog, modelId, day) : null
  const costUsd = price ? computeCostUsd(price, event.usage) : 0

  return {
    eventId,
    candidate: { index, event, day, flagStatus, flagReason, modelId, costUsd },
  }
}

export async function processIngestBatch(db: Db, input: ProcessInput): Promise<ProcessOutcome> {
  const envelope = ingestEnvelopeBaseSchema.safeParse(input.body)
  if (!envelope.success) {
    return { kind: 'invalid_envelope' }
  }

  const { batch_id: batchId, client, events } = envelope.data
  const catalog = await loadCatalog(db)
  const classified = events.map((raw, index) => classify(raw, index, input.now, catalog))

  const results: EventResult[] = classified.map(
    (c) => c.rejection ?? { event_id: c.eventId, status: 'accepted' }
  )

  await db.transaction(async (tx) => {
    for (const item of classified) {
      if (!item.candidate) continue
      const c = item.candidate

      const inserted = await tx
        .insert(usageEvents)
        .values(toEventRow(c, input, client))
        .onConflictDoNothing()
        .returning({ id: usageEvents.id })

      if (inserted.length === 0) {
        results[c.index] = { event_id: item.eventId, status: 'duplicate' }
        continue
      }
      // suspect 事件落库但不进聚合（shadow 处理，改判后重算）
      if (c.flagStatus === 'suspect') continue

      await upsertRollup(tx, c, input)
    }

    const counted = countResults(results)
    await tx
      .insert(ingestBatches)
      .values({
        id: batchId,
        authCodeId: input.auth.authCodeId,
        receivedAt: input.now,
        eventsTotal: results.length,
        eventsAccepted: counted.accepted,
        eventsDuplicate: counted.duplicate,
        eventsRejected: counted.rejected,
        geoCountry: input.geoCountry,
        ipHash: input.ipHash,
        pluginVersion: client.plugin_version,
      })
      .onConflictDoNothing()
  })

  return { kind: 'ok', response: { batch_id: batchId, results } }
}

function toEventRow(c: Candidate, input: ProcessInput, client: ClientInfo) {
  return {
    eventId: c.event.event_id,
    userId: input.auth.userId,
    authCodeId: input.auth.authCodeId,
    agent: c.event.agent,
    agentVersion: client.agent_version ?? null,
    pluginVersion: client.plugin_version,
    eventType: c.event.event_type,
    sessionId: c.event.session_id,
    messageId: c.event.message_id,
    modelRaw: c.event.model_raw,
    modelId: c.modelId,
    inputTokens: c.event.usage.input_tokens,
    outputTokens: c.event.usage.output_tokens,
    cacheCreationTokens: c.event.usage.cache_creation_tokens,
    cacheReadTokens: c.event.usage.cache_read_tokens,
    occurredAt: new Date(c.event.occurred_at),
    receivedAt: input.now,
    turnDurationMs: c.event.turn_duration_ms ?? null,
    geoCountry: input.geoCountry,
    geoCity: input.geoCity,
    ipHash: input.ipHash,
    flagStatus: c.flagStatus,
    flagReason: c.flagReason,
  }
}

async function upsertRollup(tx: Db, c: Candidate, input: ProcessInput): Promise<void> {
  const usage = c.event.usage
  const cost = c.costUsd.toFixed(6)

  await tx
    .insert(usageDailyRollups)
    .values({
      userId: input.auth.userId,
      day: c.day,
      agent: c.event.agent,
      modelId: c.modelId ?? UNKNOWN_MODEL_KEY,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_tokens,
      cacheReadTokens: usage.cache_read_tokens,
      estCostUsd: cost,
      eventsCount: 1,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        usageDailyRollups.userId,
        usageDailyRollups.day,
        usageDailyRollups.agent,
        usageDailyRollups.modelId,
      ],
      set: {
        inputTokens: sql`${usageDailyRollups.inputTokens} + ${usage.input_tokens}`,
        outputTokens: sql`${usageDailyRollups.outputTokens} + ${usage.output_tokens}`,
        cacheCreationTokens: sql`${usageDailyRollups.cacheCreationTokens} + ${usage.cache_creation_tokens}`,
        cacheReadTokens: sql`${usageDailyRollups.cacheReadTokens} + ${usage.cache_read_tokens}`,
        estCostUsd: sql`${usageDailyRollups.estCostUsd} + ${cost}::numeric`,
        eventsCount: sql`${usageDailyRollups.eventsCount} + 1`,
        updatedAt: input.now,
      },
    })
}

function countResults(results: EventResult[]): {
  accepted: number
  duplicate: number
  rejected: number
} {
  return results.reduce(
    (acc, r) => ({
      accepted: acc.accepted + (r.status === 'accepted' ? 1 : 0),
      duplicate: acc.duplicate + (r.status === 'duplicate' ? 1 : 0),
      rejected: acc.rejected + (r.status === 'rejected' ? 1 : 0),
    }),
    { accepted: 0, duplicate: 0, rejected: 0 }
  )
}
