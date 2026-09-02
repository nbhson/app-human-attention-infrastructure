import { and, inArray, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { TaskStatus } from '@harness/domain';

import { requireConnectionString } from './env.js';
import { tasks } from './schema/index.js';

/**
 * Q8 smoke alarm (day-27 §2.3): list tasks stuck in an in-flight state past the
 * orphan window. It is a *detector*, not a fixer — when it finds rows a human
 * investigates (runbook, day-29). Never auto-"repair" an EXECUTING task (day-27 §6).
 *
 * Exits 0 when the queue of orphans is empty, 1 otherwise, so it can be wired
 * into a scheduler/health-check as an alarm.
 */
const ORPHAN_WINDOW_MS = 10 * 60_000;

const client = postgres(requireConnectionString(), { max: 1 });
const db = drizzle(client);

try {
  const cutoff = new Date(Date.now() - ORPHAN_WINDOW_MS);
  const rows = await db
    .select({ id: tasks.id, state: tasks.state, updated_at: tasks.updated_at })
    .from(tasks)
    .where(and(inArray(tasks.state, [TaskStatus.Executing, TaskStatus.Verifying]), lt(tasks.updated_at, cutoff)))
    .orderBy(tasks.updated_at);

  if (rows.length === 0) {
    console.log('[audit:orphans] 0 orphaned tasks.');
  } else {
    console.log(`[audit:orphans] ${rows.length} orphaned task(s):`);
    for (const row of rows) {
      console.log(`  ${row.id}  state=${row.state}  updated_at=${row.updated_at.toISOString()}`);
    }
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
