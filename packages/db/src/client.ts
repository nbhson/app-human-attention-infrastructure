import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

/** A Drizzle instance typed against the full relational schema. */
export type DrizzleDB = PostgresJsDatabase<typeof schema>;

/**
 * Create a Drizzle instance bound to a postgres.js client.
 *
 * @param connectionString - `postgres://user:pass@host:port/db`.
 */
export function createDb(connectionString: string): DrizzleDB {
  return drizzle(postgres(connectionString), { schema });
}
