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

async function upsertUser(db: Db, profile: GithubProfile): Promise<string> {
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

  const inserted = await db
    .insert(users)
    .values({
      email: profile.email,
      githubId: profile.githubId,
      avatarUrl: profile.avatarUrl,
      displayName: profile.login,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { githubId: profile.githubId, avatarUrl: profile.avatarUrl, updatedAt: new Date() },
    })
    .returning({ id: users.id })

  const row = inserted[0]
  if (!row) throw new Error('failed to upsert user')
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
