import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import * as schema from './schema.ts'

// HTTP driver (no persistent TCP socket) — el driver node-postgres/Pool no es
// fiable en el runtime de Cloudflare Workers, donde los sockets no sobreviven
// de forma segura entre invocaciones. Este es el driver que Neon recomienda
// para Workers.
const sql = neon(process.env.DATABASE_URL!)

export const db = drizzle(sql, { schema })
