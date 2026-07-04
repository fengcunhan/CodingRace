import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'
import type { Db } from './types'

// Cloudflare Workers（workerd）无 Node TCP socket，postgres-js 无法连库。
// 读路径用 neon-http：每个查询是独立无状态 HTTP fetch，可安全跨请求缓存，Workers 下最稳。
// 写/事务路径用 neon-serverless WebSocket Pool，但绝不跨请求复用（连接会失效）——
// 每次事务新建 Pool、用完即关，见 withTransaction。
neonConfig.webSocketConstructor = WebSocket

function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not configured')
  }
  return url
}

let cachedReadDb: Db | undefined

export function getDb(): Db {
  cachedReadDb ??= drizzleHttp(neon(databaseUrl()), { schema }) as unknown as Db
  return cachedReadDb
}

// 交互式事务专用：每次调用新建 WebSocket Pool，回调结束后必定关闭。
// 用于 ingest（需要 insert-returning 后条件写 rollup 的原子性）。
export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl() })
  try {
    return await fn(drizzleWs(pool, { schema }) as unknown as Db)
  } finally {
    await pool.end()
  }
}
