'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { generateAuthCode } from '@/auth/codes'
import { getSessionUser } from '@/auth/user'
import { getDb } from '@/db/client'
import { authCodes, users } from '@/db/schema'

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(32),
  isPublic: z.boolean(),
})

export async function updateProfile(formData: FormData): Promise<void> {
  const user = await getSessionUser()
  if (!user) return

  const parsed = profileSchema.safeParse({
    displayName: formData.get('displayName'),
    isPublic: formData.get('isPublic') === 'on',
  })
  if (!parsed.success) return

  await getDb()
    .update(users)
    .set({
      displayName: parsed.data.displayName,
      isPublic: parsed.data.isPublic,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))

  revalidatePath('/settings')
  revalidatePath('/')
}

export interface CreateCodeState {
  code?: string
  error?: string
}

export async function createAuthCode(
  _prev: CreateCodeState,
  formData: FormData
): Promise<CreateCodeState> {
  const user = await getSessionUser()
  if (!user) return { error: '请先登录' }

  const label = z
    .string()
    .trim()
    .max(64)
    .catch('')
    .parse(formData.get('label') ?? '')

  const generated = generateAuthCode()
  await getDb().insert(authCodes).values({
    userId: user.id,
    codeHash: generated.codeHash,
    codePrefix: generated.codePrefix,
    label: label || null,
  })

  revalidatePath('/settings')
  return { code: generated.code }
}

export async function revokeAuthCode(formData: FormData): Promise<void> {
  const user = await getSessionUser()
  if (!user) return

  const parsed = z.uuid().safeParse(formData.get('codeId'))
  if (!parsed.success) return

  await getDb()
    .update(authCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(authCodes.id, parsed.data), eq(authCodes.userId, user.id)))

  revalidatePath('/settings')
}
