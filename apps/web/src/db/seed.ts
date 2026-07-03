import { SEED_MODELS } from './catalog-data'
import { getDb } from './client'
import { modelPrices, models } from './schema'
import type { Db } from './types'

export async function seedCatalog(db: Db): Promise<void> {
  for (const model of SEED_MODELS) {
    await db
      .insert(models)
      .values({ id: model.id, vendor: model.vendor, displayName: model.displayName })
      .onConflictDoUpdate({
        target: models.id,
        set: { vendor: model.vendor, displayName: model.displayName },
      })

    for (const p of model.prices) {
      await db
        .insert(modelPrices)
        .values({
          modelId: model.id,
          effectiveFrom: p.effectiveFrom,
          inputUsdPerMtok: p.inputUsdPerMtok,
          outputUsdPerMtok: p.outputUsdPerMtok,
          cacheWriteUsdPerMtok: p.cacheWriteUsdPerMtok,
          cacheReadUsdPerMtok: p.cacheReadUsdPerMtok,
        })
        .onConflictDoUpdate({
          target: [modelPrices.modelId, modelPrices.effectiveFrom],
          set: {
            inputUsdPerMtok: p.inputUsdPerMtok,
            outputUsdPerMtok: p.outputUsdPerMtok,
            cacheWriteUsdPerMtok: p.cacheWriteUsdPerMtok,
            cacheReadUsdPerMtok: p.cacheReadUsdPerMtok,
          },
        })
    }
  }
}

// CLI 入口：DATABASE_URL=... pnpm --filter web db:seed
if (process.argv[1]?.endsWith('seed.ts')) {
  seedCatalog(getDb())
    .then(() => {
      console.error('catalog seeded')
      process.exit(0)
    })
    .catch((error) => {
      console.error('seed failed:', error)
      process.exit(1)
    })
}
