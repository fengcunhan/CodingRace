import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { authCodes, users } from '../db/schema'
import type { Db } from '../db/types'

export function hashAuthCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export type AuthResult =
  | { ok: true; authCodeId: string; userId: string }
  | { ok: false; status: 401 | 403; error: string }

export async function authenticate(db: Db, code: string): Promise<AuthResult> {
  const rows = await db
    .select({
      id: authCodes.id,
      userId: authCodes.userId,
      revokedAt: authCodes.revokedAt,
      userStatus: users.status,
    })
    .from(authCodes)
    .innerJoin(users, eq(users.id, authCodes.userId))
    .where(eq(authCodes.codeHash, hashAuthCode(code)))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return { ok: false, status: 401, error: 'invalid_auth_code' }
  }
  if (row.revokedAt) {
    return { ok: false, status: 403, error: 'auth_code_revoked' }
  }
  if (row.userStatus !== 'active') {
    return { ok: false, status: 403, error: 'account_disabled' }
  }
  return { ok: true, authCodeId: row.id, userId: row.userId }
}

export async function touchAuthCode(db: Db, authCodeId: string, now: Date): Promise<void> {
  await db.update(authCodes).set({ lastUsedAt: now }).where(eq(authCodes.id, authCodeId))
}
