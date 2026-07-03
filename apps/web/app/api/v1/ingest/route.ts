import { getDb } from '@/db/client'
import { authenticate, hashAuthCode, touchAuthCode } from '@/ingest/auth'
import { processIngestBatch } from '@/ingest/process'
import { checkRateLimit } from '@/ingest/ratelimit'
import { requestMeta } from '@/ingest/request-meta'

export async function POST(request: Request): Promise<Response> {
  const now = new Date()

  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  if (!token) {
    return Response.json({ error: 'missing_auth_code' }, { status: 401 })
  }

  // 认证前先限流（按 code 哈希 key），无效 code 的暴力尝试也被压制
  const limit = checkRateLimit(hashAuthCode(token), now.getTime())
  if (!limit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const db = getDb()
  const auth = await authenticate(db, token)
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const meta = requestMeta(request.headers, now, process.env.IP_HASH_SALT ?? 'codingrace-dev-salt')

  try {
    const outcome = await processIngestBatch(db, { body, auth, now, ...meta })
    if (outcome.kind === 'invalid_envelope') {
      return Response.json({ error: 'invalid_envelope' }, { status: 400 })
    }
    await touchAuthCode(db, auth.authCodeId, now)
    return Response.json(outcome.response)
  } catch (error) {
    console.error('ingest failed:', error)
    return Response.json({ error: 'internal_error' }, { status: 500 })
  }
}
