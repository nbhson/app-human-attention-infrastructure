import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema/index.js';

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
  // Migration SQL is unqualified (`CREATE TABLE "tasks" ...`); route it into the
  // isolated schema via search_path on this sole pooled connection.
  await sql.unsafe(`SET search_path TO "${schemaName}"`);

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
