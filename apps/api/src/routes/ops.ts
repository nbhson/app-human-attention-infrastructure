/**
 * Minimal ops endpoints (day-27 §2.4) — no dashboard UI; the database is the
 * dashboard. `GET /api/ops/health` proves the DB is reachable; `GET /api/ops/metrics`
 * returns the two gauges an operator eyeballs first: the task-state distribution,
 * the review-queue depth, and the orphan-alarm count (§2.3 Q8).
 *
 * Deliberately absent: Prometheus exporters, Grafana, log aggregation. Phase 1 runs
 * on one machine with `docker compose logs` and `psql`.
 */

import type { FastifyInstance } from 'fastify';

import { and, count, eq, inArray, lt } from 'drizzle-orm';

import { reviewQueue, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ReviewQueueStatus, TaskStatus } from '@harness/domain';

/** Orphan-alarm window (day-27 §2.3 Q8): EXECUTING/VERIFYING past this long is stuck. */
const ORPHAN_WINDOW_MS = 10 * 60_000;

/**
 * Count tasks stuck in an in-flight state longer than `olderThanMs`. This is a
 * smoke alarm, not a fixer — when it returns > 0 a human investigates; never
 * auto-"repair" the rows (day-27 §6).
 */
export async function orphanedTaskCount(
  db: DrizzleDB,
  olderThanMs = ORPHAN_WINDOW_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        inArray(tasks.state, [TaskStatus.Executing, TaskStatus.Verifying]),
        lt(tasks.updated_at, cutoff),
      ),
    );
  return rows.length;
}

/** Register the `/api/ops/*` endpoints over an already-resolved `DrizzleDB`. */
export function registerOpsRoutes(app: FastifyInstance, db: DrizzleDB): void {
  app.get('/api/ops/health', async () => {
    // A single cheap probe proves the connection is live; failure throws → 500.
    await db.select({ id: tasks.id }).from(tasks).limit(1);
    return { ok: true, now: new Date().toISOString() };
  });

  app.get('/api/ops/metrics', async () => {
    const [byState, queueRows] = await Promise.all([
      db.select({ state: tasks.state, n: count() }).from(tasks).groupBy(tasks.state),
      db
        .select({ n: count() })
        .from(reviewQueue)
        .where(eq(reviewQueue.status, ReviewQueueStatus.Queued)),
    ]);
    return {
      tasksByState: Object.fromEntries(byState.map((row) => [row.state, row.n])),
      reviewQueueDepth: queueRows[0]?.n ?? 0,
      orphanedTasks: await orphanedTaskCount(db),
    };
  });
}
