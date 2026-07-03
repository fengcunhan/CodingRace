import { eq } from 'drizzle-orm'
import { appOrigin, fetchGithubProfile, type GithubProfile } from '@/auth/github'
import { createSessionToken, getAuthSecret, sessionCookie } from '@/auth/session'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import type { Db } from '@/db/types'

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`))
  return match ? (match.split('=')[1] ?? null) : null
}

// githubId 是唯一身份键。email 撞车时绝不把已有账号 rebind 到新的 GitHub 身份——
// GitHub 邮箱可释放后被他人验证占用，rebind 等于账号接管。
async function upsertUser(db: Db, profile: GithubProfile): Promise<string | null> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, profile.githubId))
    .limit(1)

  if (existing[0]) {
    await db
      .update(users)
      .set({ avatarUrl: profile.avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, existing[0].id))
    return existing[0].id
  }

  const emailTaken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1)
  if (emailTaken[0]) return null

  const inserted = await db
    .insert(users)
    .values({
      email: profile.email,
      githubId: profile.githubId,
      avatarUrl: profile.avatarUrl,
      displayName: profile.login,
    })
    .returning({ id: users.id })

  const row = inserted[0]
  if (!row) throw new Error('failed to insert user')
  return row.id
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = readCookie(request, 'cr_oauth_state')

  if (!code || !state || !cookieState || state !== cookieState) {
    return Response.json({ error: 'invalid_oauth_state' }, { status: 400 })
  }

  try {
    const origin = appOrigin(request.url)
    const profile = await fetchGithubProfile(origin, code)
    const userId = await upsertUser(getDb(), profile)
    if (!userId) {
      return Response.json({ error: 'email_already_linked' }, { status: 409 })
    }
    const token = createSessionToken(userId, getAuthSecret(), new Date())

    const headers = new Headers({ location: `${origin}/settings` })
    headers.append('set-cookie', sessionCookie(token))
    headers.append('set-cookie', 'cr_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    return new Response(null, { status: 302, headers })
  } catch (error) {
    console.error('oauth callback failed:', error)
    return Response.json({ error: 'oauth_failed' }, { status: 502 })
  }
}
