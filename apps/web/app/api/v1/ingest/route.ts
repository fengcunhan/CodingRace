import { MAX_BODY_BYTES } from '@codingrace/schema'
import { getDb, withTransaction } from '@/db/client'
import { authenticate, hashAuthCode, touchAuthCode } from '@/ingest/auth'
import { getIpHashSalt } from '@/ingest/config'
import { processIngestBatch } from '@/ingest/process'
import { checkRateLimit, type RateLimitResult } from '@/ingest/ratelimit'
import { clientIp, requestMeta } from '@/ingest/request-meta'

function rateLimited(limit: RateLimitResult): Response {
  return Response.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
  )
}

export async function POST(request: Request): Promise<Response> {
  const now = new Date()

  // 协议上限 256KB，解析前先按 Content-Length 拒绝超大包
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  if (!token) {
    return Response.json({ error: 'missing_auth_code' }, { status: 401 })
  }

  // 认证前双重限流：按来源 IP（防轮换 code 撞库）+ 按 code 哈希（防单 code 超频）
  const ipLimit = checkRateLimit(`ip:${clientIp(request.headers) ?? 'unknown'}`, now.getTime())
  if (!ipLimit.allowed) {
    return rateLimited(ipLimit)
  }
  const codeLimit = checkRateLimit(`code:${hashAuthCode(token)}`, now.getTime())
  if (!codeLimit.allowed) {
    return rateLimited(codeLimit)
  }

  // 认证用无状态读连接
  const auth = await authenticate(getDb(), token)
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    const meta = requestMeta(request.headers, now, getIpHashSalt())
    // 事务用每请求独立的 WebSocket 连接，用完即关
    const outcome = await withTransaction((db) =>
      processIngestBatch(db, { body, auth, now, ...meta })
    )
    if (outcome.kind === 'invalid_envelope') {
      return Response.json({ error: 'invalid_envelope' }, { status: 400 })
    }
    // 批次已提交，last_used_at 只做尽力更新，失败不影响响应
    await touchAuthCode(getDb(), auth.authCodeId, now).catch((error) => {
      console.error('touch auth code failed:', error)
    })
    return Response.json(outcome.response)
  } catch (error) {
    console.error('ingest failed:', error)
    return Response.json({ error: 'internal_error' }, { status: 500 })
  }
}
