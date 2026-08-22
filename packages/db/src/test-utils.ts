import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema/index.js';

export { FaultyDb } from './faults.js';
export type { Fault, FaultOp } from './faults.js';

// Both `src/` and the compiled `dist/` live one directory below `packages/db`,
// so a single `..` reaches `packages/db` and `migrations` resolves correctly
// whether this module is imported from source (vitest) or from `dist` (a
// workspace consumer like `@harness/orchestrator`).
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export interface TestDb {
  readonly sql: Sql;
  readonly db: PostgresJsDatabase<typeof schema>;
}

export function testConnectionString(): string {
  return process.env.DATABASE_URL ?? 'postgres://harness:harness@localhost:5432/harness';
}

/**
 * Create an isolated Postgres schema, apply migrations into it, and return a
 * Drizzle instance bound to that schema. Every table (including migration
 * bookkeeping) lives inside `schemaName`, so {@link destroyTestDb} can tear it
 * all down with one `DROP SCHEMA ... CASCADE`.
 */
export async function createTestDb(schemaName: string): Promise<TestDb> {
  const sql = postgres(testConnectionString(), { max: 1, onnotice: () => {} });

  await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
  // pgvector's `vector` type is a per-database extension object, not a table we
  // can shard. Install it once into `public` and resolve it from the isolated
  // schema via the public fallback in search_path — if a prior `createTestDb` (or
  // prod `migrate`) already installed it, `IF NOT EXISTS` no-ops here. Without
  // the `public` fallback, the migration's `vector(1536)` column type throws
  // "type vector does not exist" on every test schema after the first.
  //
  // `CREATE EXTENSION IF NOT EXISTS` is not race-safe on a fresh database: two
  // concurrent `createTestDb` calls (vitest runs test files in parallel) can
  // both pass the existence check, then the loser fails the unique insert on
  // `pg_extension_name_index`. Serialise the install behind a transaction-scoped
  // advisory lock so the winner installs `vector` and every other caller waits,
  // then no-ops via `IF NOT EXISTS`.
  await sql.begin(async (tx) => {
    await tx.unsafe(`SELECT pg_advisory_xact_lock(8061551)`);
    await tx.unsafe(`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`);
  });
  // Migration SQL is unqualified (`CREATE TABLE "tasks" ...`); route it into the
  // isolated schema via search_path on this sole pooled connection.
  await sql.unsafe(`SET search_path TO "${schemaName}", public`);

  const db = drizzle(sql, { schema });

  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: schemaName,
    migrationsTable: '__drizzle_migrations',
  });

  return { sql, db };
}

export async function destroyTestDb(testDb: TestDb, schemaName: string): Promise<void> {
  await testDb.sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await testDb.sql.end();
}

/**
 * Open a *second* independent connection (max 1) onto an already-created test
 * schema, pointed at the same `search_path`. This exists for concurrency tests
 * that need two truly-independent transactions (e.g. `SKIP LOCKED`): two
 * Dispatchers, one on `createTestDb`'s connection and one on this, can contend
 * on the same row without serialising on a shared pool.
 *
 * The schema lifecycle is the caller's: call `sql.end()` on the returned client
 * when done, but do **not** pass it to {@link destroyTestDb}.
 */
export async function openTestDbConnection(schemaName: string): Promise<TestDb> {
  const sql = postgres(testConnectionString(), { max: 1, onnotice: () => {} });
  await sql.unsafe(`SET search_path TO "${schemaName}", public`);
  const db = drizzle(sql, { schema });
  return { sql, db };
}
