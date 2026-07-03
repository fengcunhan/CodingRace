import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let cached: ReturnType<typeof createDb> | undefined

function createDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }
  // prepare:false 兼容事务模式连接池（Neon pooler / pgbouncer）；
  // Workers 环境下保持小连接数
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return drizzle(sql, { schema })
}

export function getDb() {
  cached ??= createDb()
  return cached
}
