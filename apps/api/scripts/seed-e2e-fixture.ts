/**
 * Day-27 §3.1 — E2E fixture seeder (`pnpm seed:e2e-fixture`).
 *
 * Places the Week-6 canonical fixture into a *fresh* environment before the E2E
 * driver runs: both a dev stack and the throwaway docker-compose canary need the
 * REVIEWER principal in place so the guarded review routes can attribute a
 * decision to a live identity (day-02 §2.4). The driver itself re-seeds this same
 * row after truncating the schema, so this script exists to decouple "the
 * environment is ready" from "the driver just ran" — a Phase-3 nightly canary
 * calls it once at provision time, then runs `pnpm e2e` repeatedly.
 *
 * The principal is seeded **idempotently** (`onConflictDoNothing`): the fixed
 * `id`/`oidc_sub` are the same constants the driver asserts, so re-running is a
 * no-op rather than a duplicate-key failure.
 *
 * Run via `pnpm seed:e2e-fixture` (needs `DATABASE_URL`) after
 * `pnpm --filter @harness/db migrate`.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { eq } from 'drizzle-orm';

import { users, createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: join(REPO_ROOT, '.env') });

/**
 * The Week-6 REVIEWER principal. `id` + `oidc_sub` are fixed so the E2E driver's
 * mock OIDC login (`MOCK_OIDC_SUB = 'e2e-reviewer'`) resolves to this exact row
 * through `findOrCreateUser`.
 */
const E2E_REVIEWER = {
  id: 'e2e-user-0000-0000-0000-000000000001',
  oidc_sub: 'e2e-reviewer',
  email: 'e2e@example.com',
  display_name: 'E2E Reviewer',
  roles: ['OPERATOR', 'REVIEWER'],
};

async function seedReviewerIfMissing(db: DrizzleDB): Promise<boolean> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.oidc_sub, E2E_REVIEWER.oidc_sub))
    .limit(1);

  if (existing.length > 0) {
    return false; // already present — an idempotent no-op
  }

  await db.insert(users).values(E2E_REVIEWER).onConflictDoNothing();
  return true;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (repo root).');
  }
  const db = createDb(connectionString);
  try {
    const inserted = await seedReviewerIfMissing(db);
    console.log(
      `[seed:e2e-fixture] REVIEWER principal ready ` +
        `(${E2E_REVIEWER.email}, roles=${E2E_REVIEWER.roles.join('+')}) — ` +
        `${inserted ? 'seeded' : 'already present'}`,
    );
  } finally {
    await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed:e2e-fixture] FAILED:', err);
    process.exit(1);
  },
);
