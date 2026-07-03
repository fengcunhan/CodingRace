import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let cached: ReturnType<typeof createDb> | undefined

function createDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }
  const sql = postgres(databaseUrl)
  return drizzle(sql, { schema })
}

export function getDb() {
  cached ??= createDb()
  return cached
}
