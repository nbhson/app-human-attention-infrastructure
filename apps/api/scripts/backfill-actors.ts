/**
 * Backfill actor identity onto legacy review decisions (day-02 §3.1).
 *
 * Phase 1 recorded `decisions.reviewer_id` as a free-form string ('reviewer-1',
 * an env-configured name, or a UUID) with no FK and no `actor_id`. Day 02 adds
 * `actor_id`/`actor_email` and real auth identity, but existing rows predate it.
 *
 * Rule (day-02 §6): **honest null, not a guessed join.** A legacy `reviewer_id`
 * is only backfilled when it maps to a real `users` row — matching `email` or
 * `oidc_sub`. Anything unmappable is left `actor_id = NULL`, auditable but not
 * invented. Running this script is safe to repeat: it only touches rows where
 * `actor_id IS NULL`.
 *
 * Run via `pnpm --filter @harness/api backfill:actors` (needs `DATABASE_URL`).
 */

import { eq, isNull } from 'drizzle-orm';

import { createDb, decisions, users } from '@harness/db';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    '[backfill:actors] DATABASE_URL is not set. Copy .env.example to .env (repo root).',
  );
}
const db = createDb(connectionString);

/** Find a matching user for a legacy reviewer_id, or `undefined` to leave null. */
async function findActor(reviewerId: string): Promise<{ id: string; email: string } | undefined> {
  const byEmail = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, reviewerId))
    .limit(1);
  if (byEmail[0]) {
    return byEmail[0];
  }
  const bySub = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.oidc_sub, reviewerId))
    .limit(1);
  return bySub[0];
}

const rows = await db
  .select({ id: decisions.id, reviewer_id: decisions.reviewer_id })
  .from(decisions)
  .where(isNull(decisions.actor_id));

let mapped = 0;
let leftNull = 0;
for (const row of rows) {
  const actor = await findActor(row.reviewer_id);
  if (actor) {
    await db
      .update(decisions)
      .set({ actor_id: actor.id, actor_email: actor.email })
      .where(eq(decisions.id, row.id));
    mapped += 1;
  } else {
    leftNull += 1; // honest null — no fabricated join
  }
}

console.log(`[backfill:actors] scanned=${rows.length} mapped=${mapped} left-null=${leftNull}`);
// Close the underlying postgres connection so the script exits cleanly.
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
