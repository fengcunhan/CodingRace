import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'cr_session'
export const SESSION_TTL_SECONDS = 30 * 24 * 3600

// fail closed：只有明确的 development/test 环境才允许回退开发密钥，
// NODE_ENV 缺失一律视为生产
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return 'codingrace-dev-secret'
  }
  throw new Error('AUTH_SECRET must be configured')
}

interface SessionPayload {
  uid: string
  exp: number
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

// 无状态会话令牌：base64url(payload).hmac 签名，Workers/Node 通用
export function createSessionToken(userId: string, secret: string, now: Date): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded, secret)}`
}

export function verifySessionToken(token: string, secret: string, now: Date): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const encoded = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = sign(encoded, secret)

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < now.getTime()) return null
    return payload.uid
  } catch {
    return null
  }
}

export function sessionCookie(token: string, maxAgeSeconds: number = SESSION_TTL_SECONDS): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
