import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'

// postgres-js（生产）与 PGlite（测试）驱动的公共类型，业务代码只依赖它
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
