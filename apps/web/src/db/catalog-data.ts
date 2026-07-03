// 定价来源：https://platform.claude.com/docs/en/about-claude/pricing（2026-07-03 核对）
// 单位：USD / 百万 token。effective_from '2025-01-01' 为建库基线（系统无更早数据）。
// 价格变动时追加带新 effective_from 的行，绝不修改旧行——历史成本可重算。

export interface SeedPrice {
  effectiveFrom: string
  inputUsdPerMtok: string
  outputUsdPerMtok: string
  cacheWriteUsdPerMtok: string
  cacheReadUsdPerMtok: string
}

export interface SeedModel {
  id: string
  vendor: string
  displayName: string
  prices: SeedPrice[]
}

const BASELINE = '2025-01-01'

function price(
  effectiveFrom: string,
  input: string,
  output: string,
  cacheWrite: string,
  cacheRead: string
): SeedPrice {
  return {
    effectiveFrom,
    inputUsdPerMtok: input,
    outputUsdPerMtok: output,
    cacheWriteUsdPerMtok: cacheWrite,
    cacheReadUsdPerMtok: cacheRead,
  }
}

export const SEED_MODELS: SeedModel[] = [
  {
    id: 'claude-fable-5',
    vendor: 'anthropic',
    displayName: 'Claude Fable 5',
    prices: [price(BASELINE, '10', '50', '12.5', '1')],
  },
  {
    id: 'claude-mythos-5',
    vendor: 'anthropic',
    displayName: 'Claude Mythos 5',
    prices: [price(BASELINE, '10', '50', '12.5', '1')],
  },
  {
    id: 'claude-sonnet-5',
    vendor: 'anthropic',
    displayName: 'Claude Sonnet 5',
    prices: [
      // 促销价至 2026-08-31，9 月 1 日起恢复标准价
      price('2026-09-01', '3', '15', '3.75', '0.3'),
      price(BASELINE, '2', '10', '2.5', '0.2'),
    ],
  },
  {
    id: 'claude-opus-4-8',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4.8',
    prices: [price(BASELINE, '5', '25', '6.25', '0.5')],
  },
  {
    id: 'claude-opus-4-7',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4.7',
    prices: [price(BASELINE, '5', '25', '6.25', '0.5')],
  },
  {
    id: 'claude-opus-4-6',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4.6',
    prices: [price(BASELINE, '5', '25', '6.25', '0.5')],
  },
  {
    id: 'claude-opus-4-5',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4.5',
    prices: [price(BASELINE, '5', '25', '6.25', '0.5')],
  },
  {
    id: 'claude-opus-4-1',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4.1',
    prices: [price(BASELINE, '15', '75', '18.75', '1.5')],
  },
  {
    id: 'claude-opus-4',
    vendor: 'anthropic',
    displayName: 'Claude Opus 4',
    prices: [price(BASELINE, '15', '75', '18.75', '1.5')],
  },
  {
    id: 'claude-sonnet-4-6',
    vendor: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    prices: [price(BASELINE, '3', '15', '3.75', '0.3')],
  },
  {
    id: 'claude-sonnet-4-5',
    vendor: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    prices: [price(BASELINE, '3', '15', '3.75', '0.3')],
  },
  {
    id: 'claude-sonnet-4',
    vendor: 'anthropic',
    displayName: 'Claude Sonnet 4',
    prices: [price(BASELINE, '3', '15', '3.75', '0.3')],
  },
  {
    id: 'claude-haiku-4-5',
    vendor: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    prices: [price(BASELINE, '1', '5', '1.25', '0.1')],
  },
  {
    id: 'claude-3-5-haiku',
    vendor: 'anthropic',
    displayName: 'Claude Haiku 3.5',
    prices: [price(BASELINE, '0.8', '4', '1', '0.08')],
  },
]
