import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { SESSION_COOKIE, getAuthSecret, verifySessionToken } from './session'

export interface SessionUser {
  id: string
  email: string
  displayName: string
  isPublic: boolean
  avatarUrl: string | null
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const userId = verifySessionToken(token, getAuthSecret(), new Date())
  if (!userId) return null

  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isPublic: users.isPublic,
      avatarUrl: users.avatarUrl,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = rows[0]
  if (!user || user.status !== 'active') return null
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isPublic: user.isPublic,
    avatarUrl: user.avatarUrl,
  }
}
