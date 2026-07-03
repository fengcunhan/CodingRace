import { z } from 'zod'
import { getDb } from '@/db/client'
import { queryLeaderboard } from '@/leaderboard/query'

const querySchema = z.object({
  period: z.enum(['weekly', 'all_time']).default('weekly'),
  metric: z.enum(['cost', 'tokens']).default('cost'),
  model: z.string().max(200).optional(),
  agent: z.enum(['claude_code', 'codex', 'gemini_cli', 'other']).optional(),
})

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return Response.json({ success: false, error: 'invalid_query' }, { status: 400 })
  }

  try {
    const rows = await queryLeaderboard(getDb(), { ...parsed.data, now: new Date() })
    return Response.json(
      { success: true, data: rows },
      { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    )
  } catch (error) {
    // DB 未就绪 / 查询失败时降级为空榜，保持公开 API 契约稳定（不给 500）
    console.error('leaderboard query failed, returning empty:', error)
    return Response.json({ success: true, data: [] })
  }
}
