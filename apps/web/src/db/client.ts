import { neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

// Cloudflare Workers 无 Node TCP socket，postgres-js 无法在 workerd 连库。
// Neon serverless 驱动走 WebSocket，在 Workers 与 Node 22（均有全局 WebSocket）下均可用，
// 且 Pool 会话支持 drizzle 交互式事务（ingest 依赖）。
neonConfig.webSocketConstructor = WebSocket

let cached: ReturnType<typeof createDb> | undefined

function createDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }
  const pool = new Pool({ connectionString: databaseUrl })
  return drizzle(pool, { schema })
}

export function getDb() {
  cached ??= createDb()
  return cached
}
