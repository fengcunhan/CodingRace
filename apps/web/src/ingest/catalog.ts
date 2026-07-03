import type { UsageCounts } from '@codingrace/schema'
import { modelAliases, modelPrices, models } from '../db/schema'
import type { Db } from '../db/types'

export interface CatalogPrice {
  effectiveFrom: string
  inputUsdPerMtok: number
  outputUsdPerMtok: number
  cacheWriteUsdPerMtok: number
  cacheReadUsdPerMtok: number
}

export interface Catalog {
  modelIds: Set<string>
  aliases: Map<string, string>
  // 每个模型的价格按 effectiveFrom 降序排列
  pricesByModel: Map<string, CatalogPrice[]>
}

// 每个批次加载一次目录（3 个小表），批内 100 条事件共享内存查找
export async function loadCatalog(db: Db): Promise<Catalog> {
  const [modelRows, aliasRows, priceRows] = await Promise.all([
    db.select({ id: models.id }).from(models),
    db.select().from(modelAliases),
    db.select().from(modelPrices),
  ])

  const pricesByModel = new Map<string, CatalogPrice[]>()
  for (const row of priceRows) {
    const list = pricesByModel.get(row.modelId) ?? []
    pricesByModel.set(row.modelId, [
      ...list,
      {
        effectiveFrom: row.effectiveFrom,
        inputUsdPerMtok: Number(row.inputUsdPerMtok),
        outputUsdPerMtok: Number(row.outputUsdPerMtok),
        cacheWriteUsdPerMtok: Number(row.cacheWriteUsdPerMtok),
        cacheReadUsdPerMtok: Number(row.cacheReadUsdPerMtok),
      },
    ])
  }
  for (const [modelId, list] of pricesByModel) {
    pricesByModel.set(
      modelId,
      [...list].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    )
  }

  return {
    modelIds: new Set(modelRows.map((r) => r.id)),
    aliases: new Map(aliasRows.map((r) => [r.alias, r.modelId])),
    pricesByModel,
  }
}

const REGION_PREFIX = /^(us|eu|apac|global)\./
const VENDOR_PREFIX = /^anthropic\./
const BEDROCK_VERSION_SUFFIX = /-v\d+:\d+$/
const VERTEX_DATE_SUFFIX = /@\d{8}$/
const DATE_SUFFIX = /-\d{8}$/
const LATEST_SUFFIX = /-latest$/

function resolve(catalog: Catalog, id: string): string | null {
  if (catalog.modelIds.has(id)) return id
  return catalog.aliases.get(id) ?? null
}

// 归一化顺序：原样精确匹配 → 别名表 → 规则剥离（区域/厂商前缀、
// Bedrock 版本后缀、Vertex/API 日期后缀、-latest）后再匹配；全部失败返回 null，
// 事件保留 model_raw 并进入待映射队列（idx_events_needs_norm）
export function normalizeModelId(catalog: Catalog, modelRaw: string): string | null {
  const lowered = modelRaw.trim().toLowerCase()
  const direct = resolve(catalog, lowered)
  if (direct) return direct

  const stripped = lowered
    .replace(REGION_PREFIX, '')
    .replace(VENDOR_PREFIX, '')
    .replace(BEDROCK_VERSION_SUFFIX, '')
    .replace(VERTEX_DATE_SUFFIX, '')
    .replace(DATE_SUFFIX, '')
    .replace(LATEST_SUFFIX, '')
  if (stripped === lowered) return null
  return resolve(catalog, stripped)
}

// day 为 UTC 日期串 YYYY-MM-DD；取生效日不晚于 day 的最新一档价格
export function priceFor(catalog: Catalog, modelId: string, day: string): CatalogPrice | null {
  const prices = catalog.pricesByModel.get(modelId)
  return prices?.find((p) => p.effectiveFrom <= day) ?? null
}

export function computeCostUsd(price: CatalogPrice, usage: UsageCounts): number {
  return (
    (usage.input_tokens * price.inputUsdPerMtok +
      usage.output_tokens * price.outputUsdPerMtok +
      usage.cache_creation_tokens * price.cacheWriteUsdPerMtok +
      usage.cache_read_tokens * price.cacheReadUsdPerMtok) /
    1_000_000
  )
}
