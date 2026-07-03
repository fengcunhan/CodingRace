import { describe, expect, it } from 'vitest'
import {
  computeCostUsd,
  normalizeModelId,
  priceFor,
  type Catalog,
  type CatalogPrice,
} from '../src/ingest/catalog'

const catalog: Catalog = {
  modelIds: new Set(['claude-sonnet-5', 'claude-sonnet-4-5', 'claude-3-5-haiku']),
  aliases: new Map([['my-custom-alias', 'claude-sonnet-5']]),
  pricesByModel: new Map([
    [
      'claude-sonnet-5',
      [
        {
          effectiveFrom: '2026-09-01',
          inputUsdPerMtok: 3,
          outputUsdPerMtok: 15,
          cacheWriteUsdPerMtok: 3.75,
          cacheReadUsdPerMtok: 0.3,
        },
        {
          effectiveFrom: '2025-01-01',
          inputUsdPerMtok: 2,
          outputUsdPerMtok: 10,
          cacheWriteUsdPerMtok: 2.5,
          cacheReadUsdPerMtok: 0.2,
        },
      ],
    ],
  ]),
}

describe('normalizeModelId — 各来源模型 ID 归一化', () => {
  const cases: Array<[string, string | null]> = [
    ['claude-sonnet-5', 'claude-sonnet-5'],
    ['CLAUDE-SONNET-5', 'claude-sonnet-5'],
    ['  claude-sonnet-5  ', 'claude-sonnet-5'],
    ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
    ['anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v2:0', 'claude-sonnet-4-5'],
    ['claude-sonnet-4-5@20250929', 'claude-sonnet-4-5'],
    ['claude-3-5-haiku-latest', 'claude-3-5-haiku'],
    ['claude-3-5-haiku-20241022', 'claude-3-5-haiku'],
    ['my-custom-alias', 'claude-sonnet-5'],
    ['gpt-5-codex', null],
    ['totally-unknown-model', null],
  ]

  it.each(cases)('%s → %s', (raw, expected) => {
    expect(normalizeModelId(catalog, raw)).toBe(expected)
  })
})

describe('priceFor — 定价生效日选择', () => {
  it('促销期内取促销价', () => {
    expect(priceFor(catalog, 'claude-sonnet-5', '2026-08-31')?.inputUsdPerMtok).toBe(2)
  })

  it('生效日当天起取新价', () => {
    expect(priceFor(catalog, 'claude-sonnet-5', '2026-09-01')?.inputUsdPerMtok).toBe(3)
  })

  it('早于所有生效日返回 null', () => {
    expect(priceFor(catalog, 'claude-sonnet-5', '2024-12-31')).toBeNull()
  })

  it('无定价模型返回 null', () => {
    expect(priceFor(catalog, 'claude-sonnet-4-5', '2026-07-03')).toBeNull()
  })
})

describe('computeCostUsd — 四类 token 成本折算', () => {
  const price: CatalogPrice = {
    effectiveFrom: '2025-01-01',
    inputUsdPerMtok: 2,
    outputUsdPerMtok: 10,
    cacheWriteUsdPerMtok: 2.5,
    cacheReadUsdPerMtok: 0.2,
  }

  it('按各自单价折算并求和', () => {
    const cost = computeCostUsd(price, {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_tokens: 3000,
      cache_read_tokens: 100000,
    })
    // (1000*2 + 2000*10 + 3000*2.5 + 100000*0.2) / 1e6 = 0.0495
    expect(cost).toBeCloseTo(0.0495, 6)
  })

  it('零用量成本为零', () => {
    const cost = computeCostUsd(price, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
    expect(cost).toBe(0)
  })
})
