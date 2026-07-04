import Link from 'next/link'
import { getDb } from '@/db/client'
import {
  listActiveModels,
  queryLeaderboard,
  type LeaderboardMetric,
  type LeaderboardPeriod,
} from '@/leaderboard/query'

export const dynamic = 'force-dynamic'

interface SearchParams {
  period?: string
  metric?: string
  model?: string
}

function formatCost(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

async function loadBoard(
  period: LeaderboardPeriod,
  metric: LeaderboardMetric,
  model: string | null
): Promise<readonly [Awaited<ReturnType<typeof queryLeaderboard>>, string[]]> {
  try {
    const db = getDb()
    return await Promise.all([
      queryLeaderboard(db, { period, metric, model, now: new Date() }),
      listActiveModels(db),
    ])
  } catch (error) {
    console.error('leaderboard degraded to empty state:', error)
    return [[], []] as const
  }
}

function tabHref(period: string, metric: string, model?: string): string {
  const params = new URLSearchParams({ period, metric })
  if (model) params.set('model', model)
  return `/?${params}`
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const period: LeaderboardPeriod = params.period === 'all_time' ? 'all_time' : 'weekly'
  const metric: LeaderboardMetric = params.metric === 'tokens' ? 'tokens' : 'cost'
  const model = params.model || null

  // 数据库未就绪时降级为空态，宣传引流期间不给用户看 500
  const [rows, models] = await loadBoard(period, metric, model)

  return (
    <main>
      <div className="hero">
        <h1>
          谁烧掉了最多的 <span style={{ color: 'var(--accent)' }}>Token</span>？
        </h1>
        <p>Claude Code 用量排行榜 · 安装开源插件自动上报，只统计计数，绝不上传代码</p>
        <a
          className="oss-badge"
          href="https://github.com/fengcunhan/CodingRace"
          target="_blank"
          rel="noopener"
        >
          ★ 开源于 GitHub · 代码可审计，放心使用
        </a>
      </div>

      <div className="tabs">
        <Link
          className={`tab ${period === 'weekly' ? 'active' : ''}`}
          href={tabHref('weekly', metric, model ?? undefined)}
        >
          周榜
        </Link>
        <Link
          className={`tab ${period === 'all_time' ? 'active' : ''}`}
          href={tabHref('all_time', metric, model ?? undefined)}
        >
          总榜
        </Link>
        <span style={{ width: 12 }} />
        <Link
          className={`tab ${metric === 'cost' ? 'active' : ''}`}
          href={tabHref(period, 'cost', model ?? undefined)}
        >
          按成本
        </Link>
        <Link
          className={`tab ${metric === 'tokens' ? 'active' : ''}`}
          href={tabHref(period, 'tokens', model ?? undefined)}
        >
          按 Token
        </Link>
      </div>

      {models.length > 0 && (
        <div className="tabs">
          <Link className={`tab ${!model ? 'active' : ''}`} href={tabHref(period, metric)}>
            全部模型
          </Link>
          {models.map((m) => (
            <Link
              key={m}
              className={`tab ${model === m ? 'active' : ''}`}
              href={tabHref(period, metric, m)}
            >
              {m}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <p>还没有数据。成为第一个上榜的人：</p>
          <Link className="button" href="/login">
            用 GitHub 登录 → 领取 auth-code → 安装插件
          </Link>
        </div>
      ) : (
        <table className="board">
          <thead>
            <tr>
              <th className="rank">#</th>
              <th>开发者</th>
              <th>估算成本</th>
              <th>Token 总量</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className={`rank rank-${row.rank}`}>{row.rank}</td>
                <td>
                  <span className="user-cell">
                    {row.avatarUrl && <img src={row.avatarUrl} alt="" />}
                    {row.displayName}
                  </span>
                </td>
                <td className="cost">{formatCost(row.estCostUsd)}</td>
                <td className="tokens">{formatTokens(row.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
